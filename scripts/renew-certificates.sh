#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

docker compose run --rm certbot renew \
    --webroot \
    --webroot-path /var/www/certbot \
    --quiet
docker compose exec -T nginx nginx -t
docker compose exec -T nginx nginx -s reload
