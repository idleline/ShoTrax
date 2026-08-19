#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

domain="st.shotrax.live"
expected_ip="149.28.246.92"
email="${1:-}"

resolved_ips="$(getent ahostsv4 "$domain" | awk '{print $1}' | sort -u || true)"
if ! grep -qx "$expected_ip" <<<"$resolved_ips"; then
    echo "$domain must have an A record for $expected_ip before certificate issuance." >&2
    echo "Current IPv4 answers: ${resolved_ips:-none}" >&2
    exit 1
fi

email_args=(--register-unsafely-without-email)
if [[ -n "$email" ]]; then
    email_args=(--email "$email")
fi

docker compose run --rm certbot certonly \
    --webroot \
    --webroot-path /var/www/certbot \
    --domain "$domain" \
    "${email_args[@]}" \
    --agree-tos \
    --non-interactive \
    --keep-until-expiring

cp nginx/https.conf nginx/active.conf
docker compose exec -T nginx nginx -t
docker compose exec -T nginx nginx -s reload

openssl s_client -connect 127.0.0.1:443 -servername "$domain" </dev/null 2>/dev/null \
    | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
