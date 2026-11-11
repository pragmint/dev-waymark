"""Where a client's pipeline files live, and the snapshot that ties one build's files together.

Layout under a bucket URL (`file://`, `s3://` or `az://`):

    raw/<table>/<run_id>.<load_id>.<file_id>.parquet   extract.py; append-only
    tables/<name>/<snapshot_id>.parquet                 runner.py; written once, never replaced
    snapshots/<snapshot_id>.json                        the manifest: every table's exact files
    latest.json                                         the published snapshot; written last

A snapshot is the unit of identity. Every reader (the runner's jobs, verify.py, trace.py and
Waymark) resolves a table through a manifest to an exact list of files, never a glob, so files
written after a snapshot was built can't change what it reads. Nothing but `latest.json` is ever
overwritten, which is also what object stores need: they can't rename, so a reader must never see
a half-written file under a name it trusts.
"""

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

import duckdb
import fsspec

MANIFEST_VERSION = 1
LATEST = "latest.json"
RAW_PREFIX = "raw."
SNAPSHOT_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
TABLE_DIR_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")


def sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def new_snapshot_id(now: datetime) -> str:
    return now.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def check_id(value: str) -> str:
    if not SNAPSHOT_ID_PATTERN.match(value):
        raise ValueError(f"Invalid run or snapshot id: {value!r}")
    return value


# ── Storage ───────────────────────────────────────────────────────────────────


def is_local(url: str) -> bool:
    return "://" not in url or url.startswith("file://")


def join(root: str, key: str) -> str:
    """A key under a bucket URL, in the form DuckDB reads: local paths lose `file://`."""
    base = root.removeprefix("file://") if is_local(root) else root
    return f"{base.rstrip('/')}/{key}"


def secret_statements(url: str, env: Mapping[str, str]) -> list[str]:
    """The DuckDB secret that reads `url`, from the standard cloud environment variables.

    S3 uses the AWS credential chain (env, profile, SSO, instance role). DuckDB's chain ignores
    `AWS_ENDPOINT_URL`, so an S3-compatible endpoint (MinIO, R2) is passed explicitly. Azure uses
    `AZURE_STORAGE_CONNECTION_STRING` or else the Azure credential chain for
    `AZURE_STORAGE_ACCOUNT`. Waymark's src/db/source/duckdbStorage.ts does the same.
    """
    scheme = urlparse(url).scheme
    if scheme == "s3":
        options = ["TYPE s3", "PROVIDER credential_chain"]
        region = env.get("AWS_REGION") or env.get("AWS_DEFAULT_REGION")
        if region:
            options.append(f"REGION {sql_string(region)}")
        endpoint = env.get("AWS_ENDPOINT_URL_S3") or env.get("AWS_ENDPOINT_URL")
        if endpoint:
            parsed = urlparse(endpoint)
            options += [
                f"ENDPOINT {sql_string(parsed.netloc)}",
                "URL_STYLE 'path'",
                f"USE_SSL {'true' if parsed.scheme == 'https' else 'false'}",
            ]
    elif scheme in ("az", "azure", "abfss"):
        connection_string = env.get("AZURE_STORAGE_CONNECTION_STRING")
        if connection_string:
            options = ["TYPE azure", f"CONNECTION_STRING {sql_string(connection_string)}"]
        else:
            account = env.get("AZURE_STORAGE_ACCOUNT")
            if not account:
                raise ValueError("Set AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT")
            options = ["TYPE azure", "PROVIDER credential_chain"]
            options.append(f"ACCOUNT_NAME {sql_string(account)}")
    else:
        return []
    return [f"CREATE OR REPLACE SECRET waymark_storage ({', '.join(options)})"]


def configure(con: duckdb.DuckDBPyConnection, url: str, env: Mapping[str, str]) -> None:
    for statement in secret_statements(url, env):
        con.execute(statement)


def filesystem(url: str) -> tuple[fsspec.AbstractFileSystem, str]:
    """The fsspec filesystem for a URL, and the URL's path in it. Credentials come from the
    same environment variables dlt and DuckDB use."""
    fs, path = fsspec.core.url_to_fs(url)
    return fs, path


def read_json(url: str) -> Any:
    fs, path = filesystem(url)
    with fs.open(path, "r") as file:
        return json.load(file)


def write_json(url: str, value: Any) -> None:
    """Write a small JSON file whole. Locally that's a rename, so a reader never sees half of
    it; an object store's PUT is already atomic."""
    fs, path = filesystem(url)
    text = json.dumps(value, indent=2, sort_keys=True) + "\n"
    if is_local(url):
        fs.makedirs(fs._parent(path), exist_ok=True)
        partial = path + ".partial"
        with fs.open(partial, "w") as file:
            file.write(text)
        fs.mv(partial, path)
    else:
        with fs.open(path, "w") as file:
            file.write(text)


def exists(url: str) -> bool:
    fs, path = filesystem(url)
    return fs.exists(path)


def make_parent(url: str) -> None:
    """DuckDB's COPY makes no folders on a local disk; an object store has none to make."""
    if is_local(url):
        fs, path = filesystem(url)
        fs.makedirs(fs._parent(path), exist_ok=True)


def raw_files(root: str, run_id: str) -> dict[str, list[str]]:
    """Each raw table's files from one extract run, as keys relative to `root`. dlt's own
    bookkeeping tables (`_dlt_*`) are left out."""
    fs, base = filesystem(join(root, "raw"))
    found: dict[str, list[str]] = {}
    for path in sorted(fs.glob(f"{base.rstrip('/')}/*/{check_id(run_id)}.*.parquet")):
        table, name = path.split("/")[-2:]
        if TABLE_DIR_PATTERN.match(table):
            found.setdefault(f"{RAW_PREFIX}{table}", []).append(f"raw/{table}/{name}")
    return found


# ── Snapshots ─────────────────────────────────────────────────────────────────


@dataclass
class Snapshot:
    """One build: the exact files of every table it read or wrote.

    `tables` maps a table name (`raw.<table>` for raw) to its entry in the manifest. Every entry
    has `files`, keys relative to `root`; a built table also has `rows`, `job` (the version that
    built it) and `inputs`.
    """

    root: str
    id: str
    extract: str
    tables: dict[str, dict[str, Any]]
    status: dict[str, str] = field(default_factory=dict)
    verified: bool | None = None
    env: Mapping[str, str] = field(default_factory=dict, repr=False)

    def url(self, key: str) -> str:
        return join(self.root, key)

    def output_key(self, table: str) -> str:
        return f"tables/{table}/{self.id}.parquet"

    def files(self, table: str) -> list[str]:
        entry = self.tables.get(table)
        if not entry or not entry["files"]:
            raise ValueError(f"Snapshot {self.id} has no files for {table}")
        return [self.url(key) for key in entry["files"]]

    def source(self, table: str) -> str:
        """The `read_parquet(...)` expression for one of the snapshot's tables."""
        files = ", ".join(sql_string(path) for path in self.files(table))
        return f"read_parquet([{files}], union_by_name = true)"

    def connect(self) -> duckdb.DuckDBPyConnection:
        con = duckdb.connect()
        configure(con, self.root, self.env)
        return con

    def manifest(self) -> dict[str, Any]:
        return {
            "version": MANIFEST_VERSION,
            "snapshot": self.id,
            "extract": self.extract,
            "tables": self.tables,
            "status": self.status,
            "verified": self.verified,
        }


def manifest_key(snapshot_id: str) -> str:
    return f"snapshots/{check_id(snapshot_id)}.json"


def start(root: str, run_id: str, snapshot_id: str, env: Mapping[str, str]) -> Snapshot:
    """A new snapshot over one extract run's raw files, with no tables built yet."""
    if exists(join(root, manifest_key(snapshot_id))):
        raise ValueError(f"Snapshot {snapshot_id} already exists; snapshots are never rebuilt")
    raw = raw_files(root, run_id)
    if not raw:
        raise ValueError(f"No raw files for run {run_id} under {join(root, 'raw')}")
    tables = {table: {"files": files} for table, files in raw.items()}
    return Snapshot(root, check_id(snapshot_id), run_id, tables, env=env)


def save(snapshot: Snapshot) -> str:
    """Write the manifest. Returns its URL."""
    url = join(snapshot.root, manifest_key(snapshot.id))
    write_json(url, snapshot.manifest())
    return url


def publish(snapshot: Snapshot) -> None:
    """Point `latest.json` at a saved snapshot. Waymark reads whatever this names."""
    write_json(
        join(snapshot.root, LATEST),
        {"snapshot": snapshot.id, "manifest": manifest_key(snapshot.id)},
    )


def load(root: str, snapshot_id: str | None, env: Mapping[str, str]) -> Snapshot:
    """A saved snapshot, or the published one when `snapshot_id` is None."""
    if snapshot_id is None:
        snapshot_id = read_json(join(root, LATEST))["snapshot"]
    manifest = read_json(join(root, manifest_key(snapshot_id)))
    if manifest.get("version") != MANIFEST_VERSION:
        raise ValueError(f"Unsupported manifest version: {manifest.get('version')!r}")
    return Snapshot(
        root,
        manifest["snapshot"],
        manifest["extract"],
        manifest["tables"],
        manifest.get("status", {}),
        manifest.get("verified"),
        env,
    )
