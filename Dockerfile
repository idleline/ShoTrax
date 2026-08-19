FROM python:3.13.14-slim-trixie

ARG RELEASE_VERSION=dev

LABEL org.opencontainers.image.title="ShoTrax" \
      org.opencontainers.image.version="${RELEASE_VERSION}"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv/app

RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app \
    && mkdir -p /data \
    && chown app:app /data

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY --chown=app:app app.py program_parser.py ./
COPY --chown=app:app static ./static
COPY --chown=app:app templates ./templates

USER 10001:10001
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"]

CMD ["gunicorn", "--no-control-socket", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "4", "--timeout", "90", "--graceful-timeout", "30", "--access-logfile", "-", "--error-logfile", "-", "app:app"]
