#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! docker compose version --short | awk -F. '
    { exit !(($1 > 2) || ($1 == 2 && $2 > 24) || ($1 == 2 && $2 == 24 && $3 >= 4)) }
'; then
    echo "Docker Compose 2.24.4 or newer is required for the Crystal Baseball port override." >&2
    exit 1
fi

mkdir -p state/certbot/conf state/certbot/www

if [[ -f state/certbot/conf/live/st.shotrax.live/fullchain.pem ]]; then
    cp nginx/https.conf nginx/active.conf
else
    cp nginx/http.conf nginx/active.conf
fi

docker compose config --quiet

if ss -H -ltn '( sport = :80 or sport = :443 )' | grep -q . \
    && ! docker compose ps --status running --services | grep -qx edge; then
    echo "Ports 80/443 are already in use." >&2
    echo "Run scripts/migrate-crystal-baseball.sh before the first ShoTrax deployment." >&2
    exit 1
fi

docker compose up -d --build --remove-orphans
docker compose ps
