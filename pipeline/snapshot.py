"""Where a client's pipeline files live, and the snapshot that ties one build's files together.

Layout under a bucket URL (`file://`, `s3://` or `az://`):

    raw/<table>/<run_id>.<load_id>.<file_id>.parquet   extract.py; append-only
    runs/<run_id>.json                                  extract.py, once the run finished
    runs/extract.lock                                   extract.py, while a run is going
    tables/<name>/<snapshot_id>.parquet                 runner.py; written once, never replaced
    tables/<name>/<snapshot_id>.changes.parquet         runner.py; the diff against the base
    snapshots/<snapshot_id>.json                        the manifest: every table's exact files
    latest.json                                         the published snapshot; written last

An extract run is full or incremental. Its run record lists its chain: the last full run, then
every run after it up to this one. A snapshot of a run reads the raw files of its whole chain, and
the jobs keep the latest version of each record.

A snapshot is the unit of identity. Every reader (the runner's jobs, verify.py, trace.py and
Waymark) resolves a table through a manifest to an exact list of files, never a glob, so files
written after a snapshot was built can't change what it reads. Nothing but `latest.json` is ever
overwritten, which is also what object stores need: they can't rename, so a reader must never see
a half-written file under a name it trusts.
"""

import json
import re
import socket
import uuid
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

import duckdb
import fsspec

MANIFEST_VERSION = 1
RUN_RECORD_VERSION = 1
RUN_KINDS = ("full", "incremental")
LATEST = "latest.json"
EXTRACT_LOCK = "runs/extract.lock"
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


def raw_files(root: str, run_ids: Sequence[str]) -> dict[str, list[str]]:
    """Each raw table's files from the given extract runs, in run order, as keys relative to
    `root`. dlt's own bookkeeping tables (`_dlt_*`) are left out."""
    fs, base = filesystem(join(root, "raw"))
    found: dict[str, list[str]] = {}
    for run_id in run_ids:
        for path in sorted(fs.glob(f"{base.rstrip('/')}/*/{check_id(run_id)}.*.parquet")):
            table, name = path.split("/")[-2:]
            if TABLE_DIR_PATTERN.match(table):
                found.setdefault(f"{RAW_PREFIX}{table}", []).append(f"raw/{table}/{name}")
    return found


# ── Extract runs ──────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Run:
    """One finished extract run, as its run record describes it.

    `started_at` is when it began fetching (ISO 8601 UTC). It is the next incremental run's
    cursor: anything that changed after it, even while this run was paging, is fetched again.
    `chain` is the runs a snapshot of this one reads, oldest first: the last full run, then every
    run after it, ending with this one. A `limited` run (`--max-pages`) fetched only part of its
    sources, so no later run builds on it.
    """

    id: str
    kind: str
    started_at: str
    chain: tuple[str, ...]
    limited: bool = False
    since: Mapping[str, str] = field(default_factory=dict)

    def record(self) -> dict[str, Any]:
        return {
            "version": RUN_RECORD_VERSION,
            "run": self.id,
            "kind": self.kind,
            "started_at": self.started_at,
            "chain": list(self.chain),
            "limited": self.limited,
            "since": dict(self.since),
        }


def run_key(run_id: str) -> str:
    return f"runs/{check_id(run_id)}.json"


def save_run(root: str, run: Run) -> None:
    if run.kind not in RUN_KINDS:
        raise ValueError(f"Unknown run kind: {run.kind!r}")
    if not run.chain or run.chain[-1] != run.id:
        raise ValueError(f"Run {run.id}'s chain must end with itself: {run.chain}")
    write_json(join(root, run_key(run.id)), run.record())


def run_from_record(record: Mapping[str, Any]) -> Run:
    if record.get("version") != RUN_RECORD_VERSION:
        raise ValueError(f"Unsupported run record version: {record.get('version')!r}")
    return Run(
        check_id(record["run"]),
        record["kind"],
        record["started_at"],
        tuple(check_id(r) for r in record["chain"]),
        record.get("limited", False),
        record.get("since", {}),
    )


def load_run(root: str, run_id: str) -> Run:
    """A finished run. A run with no record failed or is still going, and is never built."""
    url = join(root, run_key(run_id))
    if not exists(url):
        raise ValueError(
            f"Run {run_id} has no record at {url}: it failed, is still running, or predates run "
            f"records (extract.py --adopt-run records an old full run)"
        )
    return run_from_record(read_json(url))


def last_run(root: str) -> Run | None:
    """The run an incremental run builds on: the most recently started finished run that
    fetched everything it was asked to."""
    fs, base = filesystem(join(root, "runs"))
    if not fs.exists(base):
        return None
    runs = []
    for path in fs.glob(f"{base.rstrip('/')}/*.json"):
        with fs.open(path, "r") as file:
            runs.append(run_from_record(json.load(file)))
    complete = [run for run in runs if not run.limited]
    return max(complete, key=lambda run: (run.started_at, run.id), default=None)


class LockHeld(RuntimeError):
    """Another extract holds the bucket's lock."""


def lock_holder(root: str) -> dict[str, Any] | None:
    """Who holds the extract lock, or None if nobody does."""
    url = join(root, EXTRACT_LOCK)
    if not exists(url):
        return None
    try:
        return read_json(url)
    except (OSError, ValueError):
        # Being written right now, or left half-written by a crash: held, by someone unknown.
        return {}


@contextmanager
def extract_lock(root: str, run_id: str, now: datetime | None = None) -> Iterator[None]:
    """Hold the bucket's extract lock while the block runs, so two extracts never overlap.

    Two incremental runs at once would both continue from the same run, and whichever started
    later would become the next run's base without the other's files in its chain. The lock is
    an object created only if it doesn't exist (`O_EXCL` locally, `If-None-Match: *` on S3 and
    Azure), so it holds across machines. A crash that skips the release leaves it behind; clear
    it with `extract.py --break-lock` once you're sure no extract is running.
    """
    url = join(root, EXTRACT_LOCK)
    fs, path = filesystem(url)
    holder = {
        "run": check_id(run_id),
        "token": uuid.uuid4().hex,
        "host": socket.gethostname(),
        "locked_at": (now or datetime.now(UTC)).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    make_parent(url)
    try:
        with fs.open(path, "xb") as file:
            file.write((json.dumps(holder, indent=2, sort_keys=True) + "\n").encode())
    except FileExistsError:
        held = lock_holder(root) or {}
        run, host, since = (held.get(k, "?") for k in ("run", "host", "locked_at"))
        raise LockHeld(
            f"Another extract holds {url} (run {run} on {host} since {since}). If none is "
            f"running, clear it with extract.py --bucket-url {root} --break-lock"
        ) from None
    try:
        yield
    finally:
        # Only remove our own lock: it may have been broken and taken by another run since.
        if (lock_holder(root) or {}).get("token") == holder["token"]:
            fs.rm(path)


def break_lock(root: str) -> dict[str, Any] | None:
    """Remove the extract lock, whoever holds it. Returns who held it."""
    held = lock_holder(root)
    if held is not None:
        fs, path = filesystem(join(root, EXTRACT_LOCK))
        fs.rm(path)
    return held


# ── Snapshots ─────────────────────────────────────────────────────────────────


@dataclass
class Snapshot:
    """One build: the exact files of every table it read or wrote.

    `tables` maps a table name (`raw.<table>` for raw) to its entry in the manifest. Every entry
    has `files`, keys relative to `root`; a built table also has `rows`, `job` (the version that
    built it), `inputs`, and `changes` once it was compared with the base.

    `extract` is the run it was built from and `runs` that run's chain, whose raw files it reads.
    `base` is the snapshot that was published when it started, which its diffs compare against.
    """

    root: str
    id: str
    extract: str
    tables: dict[str, dict[str, Any]]
    status: dict[str, str] = field(default_factory=dict)
    verified: bool | None = None
    env: Mapping[str, str] = field(default_factory=dict, repr=False)
    runs: list[str] = field(default_factory=list)
    base: "Snapshot | None" = field(default=None, repr=False)

    def url(self, key: str) -> str:
        return join(self.root, key)

    def output_key(self, table: str) -> str:
        return f"tables/{table}/{self.id}.parquet"

    def changes_key(self, table: str) -> str:
        return f"tables/{table}/{self.id}.changes.parquet"

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
            "runs": self.runs or [self.extract],
            "base": self.base.id if self.base else None,
            "tables": self.tables,
            "status": self.status,
            "verified": self.verified,
        }


def manifest_key(snapshot_id: str) -> str:
    return f"snapshots/{check_id(snapshot_id)}.json"


def start(
    root: str,
    runs: Sequence[str],
    snapshot_id: str,
    env: Mapping[str, str],
    base: Snapshot | None = None,
) -> Snapshot:
    """A new snapshot over the raw files of a chain of extract runs (oldest first, ending with
    the run it's built from), with no tables built yet. Its tables are diffed against `base`."""
    if not runs:
        raise ValueError("A snapshot needs at least one extract run")
    if exists(join(root, manifest_key(snapshot_id))):
        raise ValueError(f"Snapshot {snapshot_id} already exists; snapshots are never rebuilt")
    raw = raw_files(root, runs)
    if not raw:
        raise ValueError(f"No raw files for runs {list(runs)} under {join(root, 'raw')}")
    tables = {table: {"files": files} for table, files in raw.items()}
    return Snapshot(
        root, check_id(snapshot_id), runs[-1], tables, env=env, runs=list(runs), base=base
    )


def published(root: str, env: Mapping[str, str]) -> Snapshot | None:
    """The snapshot `latest.json` names, or None before anything is published."""
    return load(root, None, env) if exists(join(root, LATEST)) else None


def save(snapshot: Snapshot) -> str:
    """Write the manifest. Returns its URL."""
    url = join(snapshot.root, manifest_key(snapshot.id))
    write_json(url, snapshot.manifest())
    return url


def recency(snapshot: Snapshot) -> tuple[str, str]:
    """How snapshots order: by the extract they read, then by when they were built. Both ids are
    UTC timestamps by default, which sort as text."""
    return (snapshot.extract, snapshot.id)


def publish(snapshot: Snapshot) -> str | None:
    """Point `latest.json` at a saved snapshot. Waymark reads whatever this names.

    Builds can finish out of order, so a snapshot older than the published one is not published:
    a slow build of an earlier extract must not point Waymark back at older data. Returns the id
    of the newer published snapshot when that happens, else None.

    The check and the write aren't atomic. Two builds finishing in the same moment can still race;
    runs that can't overlap that closely don't need more.
    """
    latest = join(snapshot.root, LATEST)
    if exists(latest):
        current = load(snapshot.root, None, snapshot.env)
        if recency(current) > recency(snapshot):
            return current.id
    write_json(latest, {"snapshot": snapshot.id, "manifest": manifest_key(snapshot.id)})
    return None


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
        manifest.get("runs", [manifest["extract"]]),
    )
