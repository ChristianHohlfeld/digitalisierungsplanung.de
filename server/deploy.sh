#!/usr/bin/env bash
set -Eeuo pipefail

umask 027

APP_DIR="${APP_DIR:-/var/www/digitalisierungsplanung.de}"
BRANCH="${BRANCH:-main}"
DOMAIN="${REALTIME_DOMAIN:-realtime.digitalisierungsplanung.de}"
REPO_URL="${REPO_URL:-https://github.com/ChristianHohlfeld/digitalisierungsplanung.de.git}"
ENV_FILE="${ENV_FILE:-/etc/digitalisierungsplanung-realtime.env}"
PM2_APP="${PM2_APP:-digitalisierungsplanung-realtime}"
DEPLOY_SKIP_GIT_SYNC="${DEPLOY_SKIP_GIT_SYNC:-0}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-20}"
HEALTH_RETRY_DELAY="${HEALTH_RETRY_DELAY:-1}"
NGINX_AVAILABLE="/etc/nginx/sites-available/${DOMAIN}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"
NGINX_BOOTSTRAP_AVAILABLE="/etc/nginx/sites-available/${DOMAIN}.bootstrap"

export APP_DIR ENV_FILE PM2_APP

log() {
  printf '[deploy] %s\n' "$*"
}

retry() {
  local attempts="$1"
  local delay="$2"
  shift 2
  local attempt=1
  until "$@"; do
    if (( attempt >= attempts )); then
      return 1
    fi
    log "Attempt ${attempt}/${attempts} failed: $*. Retrying in ${delay}s."
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}

if [[ "$(id -u)" -ne 0 ]]; then
  printf 'Run as root.\n' >&2
  exit 1
fi
if [[ ! "$HEALTH_ATTEMPTS" =~ ^[1-9][0-9]*$ || ! "$HEALTH_RETRY_DELAY" =~ ^[0-9]+$ ]]; then
  printf 'Invalid health retry settings.\n' >&2
  exit 1
fi

missing_packages=()
command -v git >/dev/null 2>&1 || missing_packages+=(git)
command -v curl >/dev/null 2>&1 || missing_packages+=(curl)
command -v nginx >/dev/null 2>&1 || missing_packages+=(nginx)
command -v openssl >/dev/null 2>&1 || missing_packages+=(openssl)
command -v certbot >/dev/null 2>&1 || missing_packages+=(certbot)
command -v flock >/dev/null 2>&1 || missing_packages+=(util-linux)
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  missing_packages+=(nodejs npm)
fi
if (( ${#missing_packages[@]} )); then
  log "Installing missing system packages: ${missing_packages[*]}"
  retry 3 5 apt-get update
  retry 3 5 apt-get install -y ca-certificates "${missing_packages[@]}"
fi
if ! command -v pm2 >/dev/null 2>&1; then
  log "Installing PM2."
  retry 3 5 npm install -g pm2
fi

mkdir -p "$(dirname "$APP_DIR")"
if [[ ! -d "$APP_DIR/.git" ]]; then
  retry 3 5 git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
elif [[ "$DEPLOY_SKIP_GIT_SYNC" != "1" ]]; then
  log "Forcing ${APP_DIR} to origin/${BRANCH}. Local repository changes are discarded."
  git -C "$APP_DIR" remote set-url origin "$REPO_URL"
  retry 3 5 git -C "$APP_DIR" fetch --prune --force origin "+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}"
  git -C "$APP_DIR" checkout -B "$BRANCH" "origin/${BRANCH}"
  git -C "$APP_DIR" reset --hard "origin/${BRANCH}"
  git -C "$APP_DIR" clean -ffdx
fi

cd "$APP_DIR"
retry 3 5 npm ci --omit=dev

export ZUSTAND_RELEASE_FILE="$APP_DIR/sw-version.js"
export ZUSTAND_RELEASE_ID
export ZUSTAND_RELEASE_SEQUENCE
export ZUSTAND_RELEASE_BUILT_AT
export ZUSTAND_RELEASE_SOURCE
export ZUSTAND_DEPLOY_COMMIT="$(git rev-parse HEAD)"
ZUSTAND_RELEASE_ID="$(sed -n 's/^self\.ZUSTAND_SW_VERSION = "\([a-zA-Z0-9._-]*\)";$/\1/p' sw-version.js | head -n 1)"
ZUSTAND_RELEASE_SEQUENCE="$(sed -n 's/^self\.ZUSTAND_RELEASE_SEQUENCE = \([0-9][0-9]*\);$/\1/p' sw-version.js | head -n 1)"
if [[ -z "$ZUSTAND_RELEASE_SEQUENCE" && "$ZUSTAND_RELEASE_ID" =~ ^(release|deploy)-([0-9]+) ]]; then
  ZUSTAND_RELEASE_SEQUENCE="${BASH_REMATCH[2]}"
fi
ZUSTAND_RELEASE_BUILT_AT="$(sed -n 's/^self\.ZUSTAND_SW_BUILT_AT = "\([^"]*\)";$/\1/p' sw-version.js | head -n 1)"
ZUSTAND_RELEASE_SOURCE="$(sed -n 's/^self\.ZUSTAND_RELEASE_SOURCE = "\([a-fA-F0-9]*\)";$/\1/p' sw-version.js | head -n 1)"
if [[ "$ZUSTAND_RELEASE_ID" == "dev-local" || ! "$ZUSTAND_RELEASE_ID" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  printf 'Refusing a production deploy without a valid shared release ID.\n' >&2
  exit 1
fi
log "Deploying ${ZUSTAND_RELEASE_ID} from ${ZUSTAND_DEPLOY_COMMIT}."

if [[ ! -f "$ENV_FILE" ]]; then
  install -m 600 /dev/null "$ENV_FILE"
  printf 'REALTIME_ROOM_SECRET=%s\n' "$(openssl rand -base64 48)" > "$ENV_FILE"
fi
if ! grep -q '^REALTIME_EMIT_SECRET=' "$ENV_FILE"; then
  printf 'REALTIME_EMIT_SECRET=%s\n' "$(openssl rand -base64 48)" >> "$ENV_FILE"
fi

pm2 startOrReload server/ecosystem.config.cjs --update-env
pm2 save
if ! systemctl list-unit-files pm2-root.service --no-legend 2>/dev/null | grep -q '^pm2-root.service'; then
  pm2 startup systemd -u root --hp /root >/tmp/digitalisierungsplanung-pm2-startup.txt
fi

mkdir -p /var/www/certbot
if systemctl list-unit-files certbot.timer --no-legend 2>/dev/null | grep -q '^certbot.timer'; then
  systemctl enable --now certbot.timer
fi

if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  install -m 644 server/nginx/realtime.digitalisierungsplanung.de.conf "$NGINX_AVAILABLE"
  ln -sfn "$NGINX_AVAILABLE" "$NGINX_ENABLED"
else
  install -m 644 server/nginx/realtime.digitalisierungsplanung.de.bootstrap.conf "$NGINX_BOOTSTRAP_AVAILABLE"
  ln -sfn "$NGINX_BOOTSTRAP_AVAILABLE" "$NGINX_ENABLED"
fi
nginx -t
systemctl reload nginx || systemctl restart nginx

health_ok=0
for _ in $(seq 1 "$HEALTH_ATTEMPTS"); do
  if payload="$(curl -fsS --max-time 5 http://127.0.0.1:8788/healthz 2>/dev/null)" &&
    EXPECTED_RELEASE="$ZUSTAND_RELEASE_ID" node -e '
      const fs = require("node:fs");
      const body = JSON.parse(fs.readFileSync(0, "utf8"));
      const expected = process.env.EXPECTED_RELEASE;
      const legacyRollback = expected.startsWith("deploy-") && body.serviceWorkerId === undefined;
      if (!body.ok || (body.serviceWorkerId !== expected && !legacyRollback)) process.exit(1);
    ' <<<"$payload"; then
    health_ok=1
    break
  fi
  sleep "$HEALTH_RETRY_DELAY"
done
if [[ "$health_ok" != "1" ]]; then
  printf 'Health check did not report release %s.\n' "$ZUSTAND_RELEASE_ID" >&2
  exit 1
fi

if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  log "Release ${ZUSTAND_RELEASE_ID} is live at wss://${DOMAIN}/ws."
else
  log "Release ${ZUSTAND_RELEASE_ID} is healthy locally. TLS is not installed yet."
  printf 'Create DNS, then run: certbot certonly --webroot -w /var/www/certbot -d %s\n' "$DOMAIN" >&2
fi
