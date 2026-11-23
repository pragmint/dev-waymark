"""Run a container job: stage its inputs as local Parquet, run its image locked down, and hand
back the Parquet file it wrote.

The runner doesn't pass bucket URIs to the container. It copies each input, resolved through the
snapshot's manifest, into one Parquet file in a work folder and mounts that folder read-only. The
container gets no network and no credentials, so it can read only what the job declares and
can't reach the bucket or anything else. It writes one Parquet file to a second mounted folder,
and the runner checks that file against the contract like a SQL job's result.

The container sees (CONTRACT.md, "Container jobs"):

- `WAYMARK_INPUTS`: JSON, input table → Parquet path, such as
  `{"entity_metadata": "/waymark/in/entity_metadata.parquet"}`;
- `WAYMARK_CHANGES`: JSON, input table → its change file, for inputs that have one;
- `WAYMARK_PARAMS`: JSON, the client's parameters (`runner.job_params`);
- `WAYMARK_OUTPUT`: the path to write the output table to.
"""

import json
import os
import re
import subprocess
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import duckdb

from snapshot import sql_string

# A registry image pinned by digest, or a local image id. Never a tag, which can move.
IMAGE_PATTERN = re.compile(r"^(?:[a-z0-9][a-z0-9._/:-]*@)?sha256:[0-9a-f]{64}$")
MOUNT = "/waymark"
OUTPUT_FILE = "output.parquet"
TIMEOUT_SECONDS = 3600
# How much of a failed container's stderr to report.
STDERR_TAIL = 2000


class ContainerError(Exception):
    pass


def check_image(image: Any) -> str:
    if not isinstance(image, str) or not IMAGE_PATTERN.match(image):
        raise ValueError(
            f"image must be pinned by digest (<repository>@sha256:<digest>, or a local "
            f"sha256:<id>), got {image!r}"
        )
    return image


def file_name(table: str) -> str:
    return table.replace(".", "__")


def stage(
    con: duckdb.DuckDBPyConnection, inputs: tuple[str, ...], changes: Mapping[str, str], work: Path
) -> tuple[dict[str, str], dict[str, str]]:
    """Copy each input, as `con` sees it, and each input's changes (a `read_parquet(...)` of its
    change files) into `work/in`. Returns the container's paths to them."""
    staged = work / "in"
    staged.mkdir(parents=True)
    (work / "out").mkdir()
    paths, change_paths = {}, {}
    for table in inputs:
        name = f"{file_name(table)}.parquet"
        target = sql_string(str(staged / name))
        con.execute(f"COPY (SELECT * FROM {table}) TO {target} (FORMAT parquet)")
        paths[table] = f"{MOUNT}/in/{name}"
    for table, source in changes.items():
        name = f"{file_name(table)}.changes.parquet"
        con.execute(f"COPY (SELECT * FROM {source}) TO {sql_string(str(staged / name))} (FORMAT parquet)")
        change_paths[table] = f"{MOUNT}/in/{name}"
    return paths, change_paths


def docker_command(image: str, work: Path, env: Mapping[str, str]) -> list[str]:
    command = [
        os.environ.get("WAYMARK_DOCKER", "docker"), "run", "--rm",
        "--network", "none",
        "--read-only", "--tmpfs", "/tmp",
        "--user", f"{os.getuid()}:{os.getgid()}",
        "--volume", f"{work / 'in'}:{MOUNT}/in:ro",
        "--volume", f"{work / 'out'}:{MOUNT}/out",
        "--env", "HOME=/tmp",
    ]  # fmt: skip
    for name, value in env.items():
        command += ["--env", f"{name}={value}"]
    return [*command, image]


def run(
    con: duckdb.DuckDBPyConnection,
    image: str,
    inputs: tuple[str, ...],
    params: Mapping[str, Any],
    work: Path,
    changes: Mapping[str, str] | None = None,
) -> Path:
    """Run the image on the inputs `con` sees and return the path of the Parquet file it wrote.
    `work` must be an empty folder the container runtime can mount."""
    paths, change_paths = stage(con, inputs, changes or {}, work)
    env = {
        "WAYMARK_INPUTS": json.dumps(paths),
        "WAYMARK_CHANGES": json.dumps(change_paths),
        "WAYMARK_PARAMS": json.dumps(params),
        "WAYMARK_OUTPUT": f"{MOUNT}/out/{OUTPUT_FILE}",
    }
    try:
        done = subprocess.run(
            docker_command(image, work, env),
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as error:
        raise ContainerError(f"container ran past {TIMEOUT_SECONDS}s") from error
    except FileNotFoundError as error:
        raise ContainerError(f"no container runtime: {error}") from error
    if done.returncode != 0:
        detail = done.stderr.strip()[-STDERR_TAIL:] or done.stdout.strip()[-STDERR_TAIL:]
        raise ContainerError(f"container exited with {done.returncode}: {detail}")
    output = work / "out" / OUTPUT_FILE
    if not output.is_file():
        raise ContainerError(f"container exited without writing {MOUNT}/out/{OUTPUT_FILE}")
    return output
