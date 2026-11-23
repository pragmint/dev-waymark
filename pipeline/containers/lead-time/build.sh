#!/usr/bin/env bash
# Build the image and write a job folder that pins it by digest, as CI would after pushing it.
#
#   containers/lead-time/build.sh <jobs dir>
#
# writes <jobs dir>/lead_time_by_issue_type/job.toml and prints the image reference. Point the
# runner at the folder with --job-dir. A local build is pinned by image id (sha256:...); an image
# pushed to a registry would be pinned as <repository>@sha256:<digest> instead.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
jobs_dir=${1:?usage: build.sh <jobs dir>}
docker=${WAYMARK_DOCKER:-docker}

image=$("$docker" build --quiet --tag waymark-job-lead-time:dev "$here")
mkdir -p "$jobs_dir/lead_time_by_issue_type"
cat >"$jobs_dir/lead_time_by_issue_type/job.toml" <<TOML
description = "Lead time by issue type, from each ticket's metadata; each row is an entity (TypeScript)."
kind = "container"
image = "$image"
inputs = ["entities[type=ticket]", "entity_metadata[entity_type=ticket]"]
entity_type = "lead_time_by_issue_type"
TOML
echo "$image"
