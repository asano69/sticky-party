#!/usr/bin/env bash
set -e

if [ -d "/certs" ] && [ "$(ls -A /certs/*.crt 2>/dev/null)" ]; then
  cp /certs/*.crt /usr/local/share/ca-certificates/
  update-ca-certificates
fi

# Bootstrap: create the first superuser if one doesn't exist yet.
# Throwaway credential meant to be rotated via the UI right after first login.
ADMIN_EMAIL="${INITIAL_ADMIN_EMAIL:-admin@mail.internal}"
ADMIN_PASSWORD="${INITIAL_ADMIN_PASSWORD:-password}"

# /web-anno/data
su-exec web-anno:web-anno web-anno superuser create "$ADMIN_EMAIL" "$ADMIN_PASSWORD" --dir=data || true

exec su-exec web-anno:web-anno "$@"
