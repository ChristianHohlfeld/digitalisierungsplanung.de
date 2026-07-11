#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${REALTIME_ENV_FILE:-/etc/digitalisierungsplanung-realtime.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$ENV_FILE"
  set +a
fi

exec node server/server.js
