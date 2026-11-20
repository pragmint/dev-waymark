"""A stand-in for `docker run`, so container jobs can be tested without a container runtime.

It takes the runner's `docker run` arguments, maps the container paths in `WAYMARK_*` back to the
mounted host folders, and runs `$FAKE_DOCKER_JOBS/<image id>.sql` over the staged inputs in DuckDB,
writing the result where the container would. Each input is a view named after its table; each
change file is a view named `changes_<table>`. It appends each call's `WAYMARK_*` variables to
`$FAKE_DOCKER_LOG` as JSON lines. An image with no SQL file exits 1, as a crashed job would.
"""

import json
import os
import sys
from pathlib import Path

import duckdb


def parse(args: list[str]) -> tuple[dict[str, str], dict[str, str], str]:
    assert args[0] == "run", args
    mounts, env = {}, {}
    rest = iter(args[1:-1])
    for arg in rest:
        if arg == "--volume":
            host, target, *_ = next(rest).split(":")
            mounts[target] = host
        elif arg in ("--env", "--network", "--tmpfs", "--user"):
            value = next(rest)
            if arg == "--env":
                name, _, text = value.partition("=")
                env[name] = text
    return mounts, env, args[-1]


def host_path(mounts: dict[str, str], path: str) -> str:
    for target, host in mounts.items():
        if path.startswith(target + "/"):
            return host + path[len(target) :]
    raise SystemExit(f"{path} is not under a mount")


def main() -> None:
    mounts, env, image = parse(sys.argv[1:])
    with open(os.environ["FAKE_DOCKER_LOG"], "a") as log:
        log.write(json.dumps({k: v for k, v in env.items() if k.startswith("WAYMARK_")}) + "\n")
    job = Path(os.environ["FAKE_DOCKER_JOBS"]) / f"{image.removeprefix('sha256:')}.sql"
    if not job.exists():
        print(f"no such job: {image}", file=sys.stderr)
        sys.exit(1)
    con = duckdb.connect()
    con.execute("CREATE SCHEMA raw")
    views = {table: path for table, path in json.loads(env["WAYMARK_INPUTS"]).items()}
    for table, path in json.loads(env["WAYMARK_CHANGES"]).items():
        views["changes_" + table.replace(".", "_")] = path
    for name, path in views.items():
        source = f"read_parquet('{host_path(mounts, path)}')"
        con.execute(f"CREATE VIEW {name} AS SELECT * FROM {source}")
    output = host_path(mounts, env["WAYMARK_OUTPUT"])
    con.execute(f"COPY ({job.read_text()}) TO '{output}' (FORMAT parquet)")


if __name__ == "__main__":
    main()
