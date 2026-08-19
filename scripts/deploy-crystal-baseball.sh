#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

crystal_dir="${CRYSTAL_BASEBALL_DIR:-/opt/crystal-baseball/current}"
override_file="$(pwd)/integration/crystal-baseball.override.yaml"

if [[ ! -f "$crystal_dir/compose.yaml" ]]; then
    echo "Crystal Baseball compose file not found at $crystal_dir/compose.yaml." >&2
    exit 1
fi

docker compose \
    -f "$crystal_dir/compose.yaml" \
    -f "$override_file" \
    up -d --build --remove-orphans
docker compose \
    -f "$crystal_dir/compose.yaml" \
    -f "$override_file" \
    ps
