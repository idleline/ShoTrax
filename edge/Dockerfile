FROM nginx:1.30.4-alpine3.24-slim

ARG RELEASE_VERSION=dev

LABEL org.opencontainers.image.title="ShoTrax SNI edge" \
      org.opencontainers.image.version="${RELEASE_VERSION}"

COPY nginx.conf /etc/nginx/nginx.conf
