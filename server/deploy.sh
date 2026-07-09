#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/digitalisierungsplanung.de}"
BRANCH="${BRANCH:-main}"
DOMAIN="${REALTIME_DOMAIN:-realtime.digitalisierungsplanung.de}"
REPO_URL="${REPO_URL:-https://github.com/ChristianHohlfeld/digitalisierungsplanung.de.git}"
ENV_FILE="${ENV_FILE:-/etc/digitalisierungsplanung-realtime.env}"
NGINX_AVAILABLE="/etc/nginx/sites-available/${DOMAIN}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"
NGINX_BOOTSTRAP_AVAILABLE="/etc/nginx/sites-available/${DOMAIN}.bootstrap"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root." >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl git nginx openssl

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  apt-get install -y nodejs npm
fi

npm install -g pm2

mkdir -p "$(dirname "$APP_DIR")"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
npm ci --omit=dev

if [ ! -f "$ENV_FILE" ]; then
  install -m 600 /dev/null "$ENV_FILE"
  printf 'REALTIME_ROOM_SECRET=%s\n' "$(openssl rand -base64 48)" > "$ENV_FILE"
fi

if ! grep -q '^REALTIME_EMIT_SECRET=' "$ENV_FILE"; then
  printf 'REALTIME_EMIT_SECRET=%s\n' "$(openssl rand -base64 48)" >> "$ENV_FILE"
fi

pm2 start server/ecosystem.config.cjs --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/tmp/digitalisierungsplanung-pm2-startup.txt

mkdir -p /var/www/certbot

if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
  cp server/nginx/realtime.digitalisierungsplanung.de.conf "$NGINX_AVAILABLE"
  ln -sf "$NGINX_AVAILABLE" "$NGINX_ENABLED"
  nginx -t
  systemctl reload nginx
  curl -fsS "http://127.0.0.1:8788/healthz"
  echo
  echo "Realtime server deployed. Public endpoint: wss://${DOMAIN}/ws"
else
  cp server/nginx/realtime.digitalisierungsplanung.de.bootstrap.conf "$NGINX_BOOTSTRAP_AVAILABLE"
  ln -sf "$NGINX_BOOTSTRAP_AVAILABLE" "$NGINX_ENABLED"
  nginx -t
  systemctl reload nginx
  echo "PM2 service is running locally, but TLS cert is missing for ${DOMAIN}." >&2
  echo "Create DNS first, then run certbot and reload nginx:" >&2
  echo "  certbot certonly --webroot -w /var/www/certbot -d ${DOMAIN}" >&2
  echo "  cp server/nginx/realtime.digitalisierungsplanung.de.conf ${NGINX_AVAILABLE}" >&2
  echo "  ln -sf ${NGINX_AVAILABLE} ${NGINX_ENABLED}" >&2
  echo "  nginx -t && systemctl reload nginx" >&2
fi
