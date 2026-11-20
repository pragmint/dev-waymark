"""The job registry: every version of every job, kept in a bucket, and which version is active.

Layout under a registry root (a client's bucket URL, or the shared registry's):

    jobs/<name>/versions/<version>/job.toml, query.sql   written once, never replaced
    jobs/<name>/active                                     one line: the active version

A version is `runner.job_version` of the job's folder, the same hash the manifest records beside
each table it builds. So a version's name is also its checksum, a snapshot names the exact code
that built each table, and pushing the same files twice is a no-op.

A client's jobs are the shared registry's active jobs, with the client's own active jobs replacing
them by name. `active` moves only through `orchestrate.py promote`, after a preview of the new
version built and verified, or through `push --activate`, which skips that check and is for seeding
a registry from a folder of jobs.
"""

import argparse
import re
import sys
import tempfile
from collections.abc import Sequence
from pathlib import Path

import snapshot as snapshots
from runner import NAME_PATTERN, Job, job_version, load_job
from snapshot import filesystem, join

VERSION_PATTERN = re.compile(r"^[0-9a-f]{16}$")


def check_name(name: str) -> str:
    if not NAME_PATTERN.match(name):
        raise ValueError(f"Invalid job name: {name!r}")
    return name


def check_version(version: str) -> str:
    if not VERSION_PATTERN.match(version):
        raise ValueError(f"Invalid job version: {version!r}")
    return version


def version_key(name: str, version: str) -> str:
    return f"jobs/{check_name(name)}/versions/{check_version(version)}"


def active_key(name: str) -> str:
    return f"jobs/{check_name(name)}/active"


def push(root: str, directory: Path) -> str:
    """Upload a job folder as a version, unless that version is already there. Returns the
    version. Only the folder's files are kept, as only they count towards the version."""
    job = load_job(directory)  # refuses a folder that isn't a valid job
    url = join(root, version_key(job.name, job.version))
    fs, path = filesystem(url)
    if not fs.exists(f"{path}/job.toml"):
        # job.toml last: a version without it is one whose upload didn't finish, and isn't listed.
        files = sorted(
            (p for p in directory.iterdir() if p.is_file()), key=lambda p: p.name == "job.toml"
        )
        for file in files:
            snapshots.make_parent(f"{url}/{file.name}")
            with fs.open(f"{path}/{file.name}", "wb") as out:
                out.write(file.read_bytes())
    return job.version


def versions(root: str, name: str) -> list[str]:
    """Every complete version of a job in the registry."""
    fs, path = filesystem(join(root, f"jobs/{check_name(name)}/versions"))
    if not fs.exists(path):
        return []
    found = [p.rstrip("/").split("/")[-2] for p in fs.glob(f"{path.rstrip('/')}/*/job.toml")]
    return sorted(v for v in found if VERSION_PATTERN.match(v))


def has_version(root: str, name: str, version: str) -> bool:
    return snapshots.exists(join(root, f"{version_key(name, version)}/job.toml"))


def active(root: str, name: str) -> str | None:
    """The job's active version, or None if it has none."""
    url = join(root, active_key(name))
    if not snapshots.exists(url):
        return None
    fs, path = filesystem(url)
    with fs.open(path, "r") as file:
        return check_version(file.read().strip())


def activate(root: str, name: str, version: str) -> None:
    """Point the job's `active` at a version already in this registry."""
    if not has_version(root, name, version):
        raise ValueError(f"{name} has no version {version} in {join(root, 'jobs')}")
    url = join(root, active_key(name))
    snapshots.make_parent(url)
    fs, path = filesystem(url)
    with fs.open(path, "w") as file:
        file.write(version + "\n")


def names(root: str) -> list[str]:
    """Every job the registry has an active version of."""
    fs, path = filesystem(join(root, "jobs"))
    if not fs.exists(path):
        return []
    found = [p.rstrip("/").split("/")[-2] for p in fs.glob(f"{path.rstrip('/')}/*/active")]
    return sorted(n for n in found if NAME_PATTERN.match(n))


def fetch(root: str, name: str, version: str, cache: Path) -> Job:
    """Download one version into `cache` and load it. Fails if its files don't hash to its
    version, so a registry can't hand back different code under a name a manifest trusts."""
    local = cache / check_version(version) / check_name(name)
    if not local.is_dir():
        fs, path = filesystem(join(root, version_key(name, version)))
        partial = Path(tempfile.mkdtemp(prefix="partial-", dir=cache)) / name
        partial.mkdir()
        for remote in fs.ls(path, detail=False):
            with fs.open(remote, "rb") as file:
                (partial / remote.rstrip("/").split("/")[-1]).write_bytes(file.read())
        local.parent.mkdir(parents=True, exist_ok=True)
        partial.rename(local)
    if job_version(local) != version:
        raise ValueError(f"{name} version {version} in {root} doesn't hash to its name")
    return load_job(local)


class Registries:
    """The registries a client's jobs come from, in order of precedence: the shared registry,
    then the client's. Downloads are kept in one temporary folder for the object's life."""

    def __init__(self, roots: Sequence[str]):
        self.roots = list(roots)
        self._cache = tempfile.TemporaryDirectory(prefix="waymark-registry-")
        self.cache = Path(self._cache.name)

    def __enter__(self) -> "Registries":
        return self

    def __exit__(self, *_: object) -> None:
        self._cache.cleanup()

    def active_jobs(self) -> list[Job]:
        """Every job's active version. A later registry's job replaces an earlier one by name."""
        chosen: dict[str, tuple[str, str]] = {}
        for root in self.roots:
            for name in names(root):
                version = active(root, name)
                if version:
                    chosen[name] = (root, version)
        return [fetch(root, name, version, self.cache) for name, (root, version) in chosen.items()]

    def job(self, name: str, version: str) -> Job:
        """A version of a job, from the last registry that has it."""
        for root in reversed(self.roots):
            if has_version(root, name, version):
                return fetch(root, name, version, self.cache)
        raise ValueError(f"No registry has {name} version {version}")

    def owner(self, name: str, version: str) -> str:
        """The last registry that has the version: the one promoting it moves `active` in."""
        for root in reversed(self.roots):
            if has_version(root, name, version):
                return root
        raise ValueError(f"No registry has {name} version {version}")


def registry_roots(bucket_url: str, shared_url: str | None) -> list[str]:
    return ([shared_url] if shared_url else []) + [bucket_url]


def job_folders(path: Path) -> list[Path]:
    """A job folder itself, or every job folder in a folder of jobs."""
    if (path / "job.toml").exists():
        return [path]
    if not path.is_dir():
        raise ValueError(f"No such job folder: {path}")
    return sorted(p for p in path.iterdir() if (p / "job.toml").exists())


def print_listing(root: str) -> None:
    fs, path = filesystem(join(root, "jobs"))
    listed = fs.ls(path, detail=False) if fs.exists(path) else []
    for name in sorted(p.rstrip("/").split("/")[-1] for p in listed):
        if not NAME_PATTERN.match(name):
            continue
        current = active(root, name)
        print(f"{name}{'' if current else '  (inactive)'}")
        for version in versions(root, name):
            print(f"  {'*' if version == current else ' '} {version}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--bucket-url",
        required=True,
        help="The registry's root: a client's bucket URL, or the shared registry's",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    push_parser = commands.add_parser("push", help="Upload job folders as versions")
    push_parser.add_argument("folders", nargs="+", type=Path, help="Job folders or folders of jobs")
    push_parser.add_argument(
        "--activate",
        action="store_true",
        help="Also make each the active version, without a preview (for seeding a registry)",
    )
    commands.add_parser("list", help="Each job's versions, the active one starred")
    args = parser.parse_args()

    try:
        if args.command == "list":
            print_listing(args.bucket_url)
            return
        for folder in args.folders:
            for directory in job_folders(folder):
                version = push(args.bucket_url, directory)
                if args.activate:
                    activate(args.bucket_url, directory.name, version)
                print(f"{directory.name}: {version}{' (active)' if args.activate else ''}")
    except ValueError as error:
        sys.exit(str(error))


if __name__ == "__main__":
    main()
