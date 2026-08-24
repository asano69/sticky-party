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

# /sticky-party/pb_data
su-exec sticky-party:sticky-party sticky-party superuser create "$ADMIN_EMAIL" "$ADMIN_PASSWORD" || true

# Bootstrap: create the first regular user if one doesn't exist yet.
# user-upsert is idempotent (create-or-update -- see cmd/sticky-party/cmd_user.go),
# so no `|| true` is needed here, unlike the superuser create above.
USER_EMAIL="${INITIAL_USER_EMAIL:-user@mail.internal}"
USER_PASSWORD="${INITIAL_USER_PASSWORD:-password}"
su-exec sticky-party:sticky-party sticky-party user-upsert "$USER_EMAIL" "$USER_PASSWORD"

exec su-exec sticky-party:sticky-party "$@"
