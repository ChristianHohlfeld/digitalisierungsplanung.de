#!/usr/bin/env bash
set -euo pipefail

if [ -f /etc/digitalisierungsplanung-realtime.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /etc/digitalisierungsplanung-realtime.env
  set +a
fi

exec node server/server.js
