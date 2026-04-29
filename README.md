# ShoTrax

ShoTrax is a small Flask web app for tracking Perfect Perfect batting outcomes and viewing summary reports.

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
- `http://127.0.0.1:8000/reports` for the reports view

You can also use `http://localhost:8000/` if you prefer.
