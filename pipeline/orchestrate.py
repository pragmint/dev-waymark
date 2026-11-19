"""Run a client's pipeline from its job registry, and promote new job versions into it.

- `run`: extract (incremental by default), load every job's active version from the registries
  (registry.py), build the snapshot, verify it, and publish it. A table whose job, parameters and
  input files are the same as in the published snapshot is reused, not built again, so a run after
  a promote builds only the promoted job and what reads it.
- `preview <job> <version>`: build the last extract run with one job swapped for another version,
  every other table reused where it can be, and verify it. The snapshot is saved but never
  published; its change files are the diff against what's live. The version can be a job folder,
  which is pushed first.
- `promote <job> <version>`: a preview, then, if every table built or was reused and verified,
  make the version active. The next `run` publishes it.

A plain function per step, so a scheduler (cron, a Worker, Dagster) can call `run` directly.
"""

import argparse
import os
import sys
import tomllib
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import registry
import snapshot as snapshots
from registry import Registries
from runner import Job, build_order, build_snapshot, publish
from snapshot import Run, Snapshot

EXTRACT_KINDS = ("incremental", "full", "none")


@dataclass(frozen=True)
class Bucket:
    """Where one client's pipeline lives: its root, which holds its raw files, snapshots and its
    own job registry, and the shared registry its jobs fall back to."""

    root: str
    shared: str | None
    env: Mapping[str, str]

    def registries(self) -> Registries:
        return Registries(registry.registry_roots(self.root, self.shared))


def extract_run(client: Mapping[str, Any], bucket: Bucket, kind: str, run_id: str | None) -> Run:
    """The extract run to build: a new one of the given kind, or with `none`, the one `run_id`
    names or else the last finished run."""
    if kind not in EXTRACT_KINDS:
        raise ValueError(f"Extract must be one of {', '.join(EXTRACT_KINDS)}, got {kind!r}")
    if kind != "none":
        # Imported here: only a run that extracts needs dlt.
        import extract

        started_at = datetime.now(UTC)
        new_id = run_id or extract.new_run_id(started_at)
        return extract.extract(
            client, bucket.root, new_id, bucket.env, full=kind == "full", started_at=started_at
        )
    if run_id:
        return snapshots.load_run(bucket.root, run_id)
    last = snapshots.last_run(bucket.root)
    if last is None:
        raise ValueError(f"No finished extract run under {bucket.root}; run with --extract full")
    return last


def start(bucket: Bucket, run: Run, snapshot_id: str) -> Snapshot:
    base = snapshots.published(bucket.root, bucket.env)
    print(f"run {run.id} ({run.kind}) reads runs {', '.join(run.chain)}")
    return snapshots.start(bucket.root, run.chain, snapshot_id, bucket.env, base)


def require_jobs(jobs: list[Job], bucket: Bucket) -> list[Job]:
    if not jobs:
        raise ValueError(
            f"No active jobs in {', '.join(registry.registry_roots(bucket.root, bucket.shared))}; "
            "seed one with registry.py push --activate"
        )
    return build_order(jobs)  # fails on an unknown input or a cycle before anything is built


def run(
    client: Mapping[str, Any],
    bucket: Bucket,
    extract: str = "incremental",
    run_id: str | None = None,
    rebuild: bool = False,
    publish_it: bool = True,
    snapshot_id: str | None = None,
) -> Snapshot | None:
    """Extract, build and publish. Returns the snapshot, or None if it failed (it's saved, but
    not published)."""
    the_run = extract_run(client, bucket, extract, run_id)
    with bucket.registries() as found:
        jobs = require_jobs(found.active_jobs(), bucket)
        snapshot_id = snapshot_id or snapshots.new_snapshot_id(datetime.now(UTC))
        snapshot = start(bucket, the_run, snapshot_id)
        if not build_snapshot(jobs, client, snapshot, reuse=not rebuild):
            print(f"snapshot {snapshot.id} not published", file=sys.stderr)
            return None
    if publish_it:
        publish(snapshot)
    return snapshot


def with_version(jobs: list[Job], job: Job) -> list[Job]:
    """The jobs with one replaced by name, or added if it's new."""
    return [j for j in jobs if j.name != job.name] + [job]


def preview(
    client: Mapping[str, Any],
    bucket: Bucket,
    name: str,
    version: str,
    run_id: str | None = None,
    snapshot_id: str | None = None,
) -> tuple[Snapshot, bool]:
    """Build the run with one job at another version, never to be published. Returns the
    snapshot and whether it would have been publishable."""
    the_run = extract_run(client, bucket, "none", run_id)
    with bucket.registries() as found:
        candidate = found.job(name, version)
        jobs = require_jobs(with_version(found.active_jobs(), candidate), bucket)
        now = snapshots.new_snapshot_id(datetime.now(UTC))
        snapshot = start(bucket, the_run, snapshot_id or f"preview-{now}-{name}-{version}")
        snapshot.preview = {"job": name, "version": version}
        ok = build_snapshot(jobs, client, snapshot)
    return snapshot, ok


def promote(
    client: Mapping[str, Any],
    bucket: Bucket,
    name: str,
    version: str,
    shared: bool = False,
    run_id: str | None = None,
) -> bool:
    """Preview the version, and make it active if the preview passed. With `shared`, it's made
    active in the shared registry, for every client; it's previewed on this client only."""
    target = bucket.shared if shared else bucket.root
    if target is None:
        raise ValueError("--shared needs --shared-url")
    if not registry.has_version(target, name, version):
        raise ValueError(f"{name} has no version {version} in {target}; push it there first")
    snapshot, ok = preview(client, bucket, name, version, run_id)
    if not ok:
        print(f"{name} {version} not promoted: preview {snapshot.id} failed", file=sys.stderr)
        return False
    registry.activate(target, name, version)
    print(f"{name}: {version} is active (preview {snapshot.id}); the next run publishes it")
    return True


def resolve_version(bucket: Bucket, value: str, shared: bool) -> tuple[str, str | None]:
    """A version, or a job folder pushed to the registry it would be promoted in. Returns the
    version and the job name the folder holds."""
    folder = Path(value)
    if not folder.is_dir():
        return registry.check_version(value), None
    target = bucket.shared if shared else bucket.root
    if target is None:
        raise ValueError("--shared needs --shared-url")
    version = registry.push(target, folder)
    print(f"pushed {folder.name} {version} to {target}")
    return version, folder.name


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--client", required=True, type=Path, help="Client config TOML")
    parser.add_argument(
        "--bucket-url", required=True, help="The client's root: a file://, s3:// or az:// URL"
    )
    parser.add_argument("--shared-url", help="The shared job registry's root")
    commands = parser.add_subparsers(dest="command", required=True)

    run_parser = commands.add_parser("run", help="Extract, build what changed, verify, publish")
    run_parser.add_argument("--extract", choices=EXTRACT_KINDS, default="incremental")
    run_parser.add_argument(
        "--run-id", help="The new run's id; with --extract none, the run to build (default: last)"
    )
    run_parser.add_argument("--snapshot-id", help="Defaults to the current UTC time")
    run_parser.add_argument("--rebuild", action="store_true", help="Build every table again")
    run_parser.add_argument("--no-publish", action="store_true", help="Don't move latest.json")

    for command, text in [
        ("preview", "Build the last run with one job at another version; never published"),
        ("promote", "Preview a version, then make it active if it passed"),
    ]:
        sub = commands.add_parser(command, help=text)
        sub.add_argument("job")
        sub.add_argument("version", help="A version in the registry, or a job folder to push")
        sub.add_argument("--run-id", help="The extract run to build (default: the last)")
        sub.add_argument(
            "--shared",
            action="store_true",
            help="The version is the shared registry's (promote makes it active for every client)",
        )
    args = parser.parse_args()

    client = tomllib.loads(args.client.read_text())
    bucket = Bucket(args.bucket_url, args.shared_url, os.environ)
    try:
        if args.command == "run":
            built = run(
                client, bucket, args.extract, args.run_id, args.rebuild,
                not args.no_publish, args.snapshot_id,
            )  # fmt: skip
            ok = built is not None
        else:
            version, folder_name = resolve_version(bucket, args.version, args.shared)
            if folder_name and folder_name != args.job:
                raise ValueError(f"The folder holds job {folder_name}, not {args.job}")
            if args.command == "preview":
                snapshot, ok = preview(client, bucket, args.job, version, args.run_id)
                print(f"preview {snapshot.id} {'passed' if ok else 'failed'}")
            else:
                ok = promote(client, bucket, args.job, version, args.shared, args.run_id)
    except (ValueError, snapshots.LockHeld) as error:
        sys.exit(str(error))
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
