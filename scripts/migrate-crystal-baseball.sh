#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

crystal_dir="${CRYSTAL_BASEBALL_DIR:-/opt/crystal-baseball/current}"
override_file="$(pwd)/integration/crystal-baseball.override.yaml"
drop_in_dir="/etc/systemd/system/crystal-baseball.service.d"

if [[ ! -f "$crystal_dir/compose.yaml" ]]; then
    echo "Crystal Baseball compose file not found at $crystal_dir/compose.yaml." >&2
    exit 1
fi

docker compose \
    -f "$crystal_dir/compose.yaml" \
    -f "$override_file" \
    config --quiet

sudo install -d -m 0755 "$drop_in_dir"
sudo install -m 0644 \
    systemd/crystal-baseball-shared-edge.conf \
    "$drop_in_dir/shared-edge.conf"
sudo systemctl daemon-reload

docker compose \
    -f "$crystal_dir/compose.yaml" \
    -f "$override_file" \
    up -d --force-recreate nginx

echo "Crystal Baseball now listens on 127.0.0.1:18080 and 127.0.0.1:18443."
