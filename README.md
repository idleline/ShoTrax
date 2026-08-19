# ShoTrax

ShoTrax is a small Flask web app for tracking Perfect Perfect batting outcomes and viewing summary reports.
It also includes a BABIP page for tracking balls hit into play by outcome, game mode, and difficulty.

## Quick Install

Clone the repo and install the Python requirements:

```bash
git clone <repo-url>
cd ShoTrax
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

If you do not want to use a virtual environment, you can install the requirements directly with:

```bash
pip3 install -r requirements.txt
```

## Launch The Web Service

Start the app from the project root:

```bash
python3 app.py
```

The service runs on port `8000` and creates its SQLite database automatically if it does not already exist.

## Open In A Browser

After the server starts, open:

- `http://127.0.0.1:8000/` for the main ShoTrax page
- `http://127.0.0.1:8000/babip` for BABIP tracking
- `http://127.0.0.1:8000/reports` for the reports view

You can also use `http://localhost:8000/` if you prefer.

## Data Exports

- Perfect Perfect CSV: `http://127.0.0.1:8000/api/events/export`
- BABIP CSV: `http://127.0.0.1:8000/api/babip/events/export`

## Docker deployment

The production stack runs ShoTrax under Gunicorn, with an app-specific Nginx TLS
terminator and a persistent Docker volume for SQLite. A shared edge Nginx owns the
public `149.28.246.92:80` and `149.28.246.92:443` endpoint:

- HTTP requests are routed by the `Host` header.
- HTTPS connections are passed through by ClientHello SNI using Nginx
  `ssl_preread`; TLS terminates in the selected app's Nginx container.
- `cb.shotrax.live` routes to Crystal Baseball on loopback ports `18080/18443`.
- `st.shotrax.live` routes to ShoTrax on loopback ports `28080/28443`.

This keeps the two certificates separate. The ShoTrax certificate has
`st.shotrax.live` as its only requested DNS name, so its subject CN and SAN identify
the ShoTrax hostname.

### First deployment on the existing Crystal Baseball host

Docker Compose 2.24.4 or newer is required. Place this release at
`/opt/shotrax/releases/<version>`, point `/opt/shotrax/current` to it, then:

```bash
cd /opt/shotrax/current
cp .env.example .env
scripts/migrate-crystal-baseball.sh
scripts/deploy.sh
scripts/enable-tls.sh you@example.com
```

The migration script installs a systemd drop-in for the existing
`crystal-baseball.service` and recreates only its Nginx container with loopback port
bindings. This releases public ports 80/443 for the shared edge without exposing the
app-specific listeners publicly.

After this migration, use `scripts/deploy-crystal-baseball.sh` from the ShoTrax
release for Crystal Baseball deployments. Its original `scripts/deploy.sh` does not
load the shared-edge override and would try to reclaim public ports 80/443.

Before certificate issuance, point the `st.shotrax.live` A record at
`149.28.246.92`. Certbot uses HTTP-01 through the edge and stores its state under
`state/certbot/`.

Install and enable the ShoTrax service and renewal timer:

```bash
sudo install -m 0644 systemd/shotrax.service /etc/systemd/system/
sudo install -m 0644 systemd/shotrax-certbot.service /etc/systemd/system/
sudo install -m 0644 systemd/shotrax-certbot.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now shotrax.service shotrax-certbot.timer
```

### Operations

```bash
docker compose ps
docker compose logs --tail=100 app nginx edge
curl -fsS -H 'Host: st.shotrax.live' http://127.0.0.1/health
openssl s_client -connect 127.0.0.1:443 -servername st.shotrax.live </dev/null
scripts/renew-certificates.sh
```

For future immutable releases, copy the existing `.env` and `state/` directory (or
keep `state/` on persistent storage), update `/opt/shotrax/current`, and run
`scripts/deploy.sh`. The named volume `shotrax_app-data` retains the SQLite database.
