#!/usr/bin/env bash
set -Eeuo pipefail

umask 027

APP_DIR="${APP_DIR:-/var/www/digitalisierungsplanung.de}"
BRANCH="${BRANCH:-main}"
REPO_URL="${REPO_URL:-https://github.com/ChristianHohlfeld/digitalisierungsplanung.de.git}"
ENV_FILE="${ENV_FILE:-/etc/digitalisierungsplanung-realtime.env}"
PM2_APP="${PM2_APP:-digitalisierungsplanung-realtime}"
STATE_DIR="${STATE_DIR:-/var/lib/digitalisierungsplanung}"
LOCK_FILE="${LOCK_FILE:-/run/lock/digitalisierungsplanung-auto-deploy.lock}"
MARKER_FILE="${MARKER_FILE:-${STATE_DIR}/deployed-release.env}"
DEPLOY_RUNNER="${DEPLOY_RUNNER:-${STATE_DIR}/deploy-runner.sh}"
UPDATE_ATTEMPTS="${UPDATE_ATTEMPTS:-3}"
UPDATE_RETRY_DELAY="${UPDATE_RETRY_DELAY:-10}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-20}"
HEALTH_RETRY_DELAY="${HEALTH_RETRY_DELAY:-1}"
AUTO_DEPLOY_INTERVAL="${AUTO_DEPLOY_INTERVAL:-60s}"
SERVICE_NAME="digitalisierungsplanung-auto-deploy"

export APP_DIR ENV_FILE PM2_APP

log() {
  printf '[auto-deploy] %s\n' "$*"
}

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    printf 'Run as root.\n' >&2
    exit 1
  fi
}

require_runtime_commands() {
  local command
  for command in git curl node pm2 nginx flock systemctl; do
    if ! command -v "$command" >/dev/null 2>&1; then
      printf 'Missing %s. Run server/deploy.sh once to bootstrap the host.\n' "$command" >&2
      return 1
    fi
  done
}

validate_settings() {
  [[ "$APP_DIR" =~ ^/[a-zA-Z0-9._/-]+$ ]] || { printf 'APP_DIR must be a simple absolute path.\n' >&2; exit 1; }
  [[ "$ENV_FILE" =~ ^/[a-zA-Z0-9._/-]+$ ]] || { printf 'ENV_FILE must be a simple absolute path.\n' >&2; exit 1; }
  [[ "$STATE_DIR" =~ ^/[a-zA-Z0-9._/-]+$ ]] || { printf 'STATE_DIR must be a simple absolute path.\n' >&2; exit 1; }
  [[ "$LOCK_FILE" =~ ^/[a-zA-Z0-9._/-]+$ ]] || { printf 'LOCK_FILE must be a simple absolute path.\n' >&2; exit 1; }
  [[ "$MARKER_FILE" =~ ^/[a-zA-Z0-9._/-]+$ ]] || { printf 'MARKER_FILE must be a simple absolute path.\n' >&2; exit 1; }
  [[ "$DEPLOY_RUNNER" =~ ^/[a-zA-Z0-9._/-]+$ ]] || { printf 'DEPLOY_RUNNER must be a simple absolute path.\n' >&2; exit 1; }
  [[ "$BRANCH" =~ ^[a-zA-Z0-9._/-]+$ ]] || { printf 'Invalid BRANCH.\n' >&2; exit 1; }
  [[ "$AUTO_DEPLOY_INTERVAL" =~ ^[0-9]+(s|min|h)$ ]] || { printf 'Invalid AUTO_DEPLOY_INTERVAL.\n' >&2; exit 1; }
  [[ "$UPDATE_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || { printf 'Invalid UPDATE_ATTEMPTS.\n' >&2; exit 1; }
  [[ "$UPDATE_RETRY_DELAY" =~ ^[0-9]+$ ]] || { printf 'Invalid UPDATE_RETRY_DELAY.\n' >&2; exit 1; }
  [[ "$HEALTH_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || { printf 'Invalid HEALTH_ATTEMPTS.\n' >&2; exit 1; }
  [[ "$HEALTH_RETRY_DELAY" =~ ^[0-9]+$ ]] || { printf 'Invalid HEALTH_RETRY_DELAY.\n' >&2; exit 1; }
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

marker_field() {
  local name="$1"
  [[ -f "$MARKER_FILE" ]] || return 0
  sed -n "s/^${name}=//p" "$MARKER_FILE" | head -n 1
}

release_source_from_ref() {
  git -C "$APP_DIR" show "$1:release-version.js"
}

release_id_from_ref() {
  release_source_from_ref "$1" | sed -n 's/^globalThis\.ZUSTAND_RELEASE_ID = "\([a-zA-Z0-9._-]*\)";$/\1/p' | head -n 1
}

release_sequence_from_ref() {
  release_source_from_ref "$1" | sed -n 's/^globalThis\.ZUSTAND_RELEASE_SEQUENCE = \([0-9][0-9]*\);$/\1/p' | head -n 1
}

release_built_at_from_ref() {
  release_source_from_ref "$1" | sed -n 's/^globalThis\.ZUSTAND_RELEASE_BUILT_AT = "\([^"]*\)";$/\1/p' | head -n 1
}

release_source_commit_from_ref() {
  release_source_from_ref "$1" | sed -n 's/^globalThis\.ZUSTAND_RELEASE_SOURCE = "\([a-fA-F0-9]*\)";$/\1/p' | head -n 1
}

write_marker() {
  local release_id="$1"
  local sequence="$2"
  local commit="$3"
  local built_at="$4"
  local source_commit="$5"
  local temporary
  mkdir -p "$STATE_DIR"
  temporary="$(mktemp "${STATE_DIR}/deployed-release.XXXXXX")"
  {
    printf 'RELEASE_ID=%s\n' "$release_id"
    printf 'RELEASE_SEQUENCE=%s\n' "$sequence"
    printf 'COMMIT=%s\n' "$commit"
    printf 'BUILT_AT=%s\n' "$built_at"
    printf 'SOURCE_COMMIT=%s\n' "$source_commit"
  } > "$temporary"
  chmod 600 "$temporary"
  mv -f "$temporary" "$MARKER_FILE"
}

prepare_deploy_runner() {
  local ref="$1"
  local temporary
  mkdir -p "$STATE_DIR"
  temporary="$(mktemp "${STATE_DIR}/deploy-runner.XXXXXX")"
  git -C "$APP_DIR" show "$ref:server/deploy.sh" > "$temporary"
  bash -n "$temporary"
  chmod 700 "$temporary"
  mv -f "$temporary" "$DEPLOY_RUNNER"
}

fetch_remote() {
  git -C "$APP_DIR" remote get-url origin >/dev/null 2>&1 || git -C "$APP_DIR" remote add origin "$REPO_URL"
  git -C "$APP_DIR" remote set-url origin "$REPO_URL"
  retry "$UPDATE_ATTEMPTS" "$UPDATE_RETRY_DELAY" \
    git -C "$APP_DIR" fetch --prune --force origin "+refs/heads/${BRANCH}:refs/remotes/origin/${BRANCH}"
}

sync_to_commit() {
  local commit="$1"
  local clean_mode="${2:-full}"
  git -C "$APP_DIR" checkout -B "$BRANCH" "$commit"
  git -C "$APP_DIR" reset --hard "$commit"
  if [[ "$clean_mode" == "full" ]]; then
    git -C "$APP_DIR" clean -ffdx
  else
    git -C "$APP_DIR" clean -ffd
  fi
}

pm2_is_online() {
  pm2 jlist 2>/dev/null | EXPECTED_PM2_APP="$PM2_APP" node -e '
    const fs = require("node:fs");
    const apps = JSON.parse(fs.readFileSync(0, "utf8"));
    const app = apps.find(item => item.name === process.env.EXPECTED_PM2_APP);
    if (!app || app.pm2_env?.status !== "online") process.exit(1);
  '
}

health_reports_release() {
  local expected="$1"
  local payload
  payload="$(curl -fsS --max-time 5 http://127.0.0.1:8788/healthz 2>/dev/null)" || return 1
  EXPECTED_RELEASE="$expected" node -e '
    const fs = require("node:fs");
    const body = JSON.parse(fs.readFileSync(0, "utf8"));
    const expected = process.env.EXPECTED_RELEASE;
    if (!body.ok || body.releaseId !== expected) process.exit(1);
  ' <<<"$payload"
}

verify_release() {
  local expected="$1"
  nginx -t >/dev/null 2>&1 || return 1
  pm2_is_online || return 1
  local attempt
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if health_reports_release "$expected"; then
      return 0
    fi
    sleep "$HEALTH_RETRY_DELAY"
  done
  return 1
}

recover_services() {
  log "Refreshing PM2 environment and restarting Nginx after an unsuccessful verification."
  pm2 restart "$PM2_APP" --update-env >/dev/null 2>&1 || \
    pm2 startOrReload "$APP_DIR/server/ecosystem.config.cjs" --update-env >/dev/null 2>&1 || true
  if nginx -t >/dev/null 2>&1; then
    systemctl restart nginx || true
  fi
}

deploy_checked_out_release() {
  local expected="$1"
  local attempt=1
  while (( attempt <= UPDATE_ATTEMPTS )); do
    log "Deploy attempt ${attempt}/${UPDATE_ATTEMPTS} for ${expected}."
    if APP_DIR="$APP_DIR" BRANCH="$BRANCH" REPO_URL="$REPO_URL" ENV_FILE="$ENV_FILE" \
      PM2_APP="$PM2_APP" HEALTH_ATTEMPTS="$HEALTH_ATTEMPTS" HEALTH_RETRY_DELAY="$HEALTH_RETRY_DELAY" \
      DEPLOY_SKIP_GIT_SYNC=1 bash "$DEPLOY_RUNNER" &&
      verify_release "$expected"; then
      return 0
    fi
    recover_services
    if verify_release "$expected"; then
      return 0
    fi
    if (( attempt < UPDATE_ATTEMPTS )); then
      sleep "$UPDATE_RETRY_DELAY"
    fi
    attempt=$((attempt + 1))
  done
  return 1
}

install_systemd() {
  require_root
  validate_settings
  require_runtime_commands
  mkdir -p "$STATE_DIR" "$(dirname "$LOCK_FILE")"
  cat > /etc/digitalisierungsplanung-auto-deploy.env <<EOF
APP_DIR=${APP_DIR}
BRANCH=${BRANCH}
REPO_URL=${REPO_URL}
ENV_FILE=${ENV_FILE}
PM2_APP=${PM2_APP}
STATE_DIR=${STATE_DIR}
LOCK_FILE=${LOCK_FILE}
MARKER_FILE=${MARKER_FILE}
DEPLOY_RUNNER=${DEPLOY_RUNNER}
UPDATE_ATTEMPTS=${UPDATE_ATTEMPTS}
UPDATE_RETRY_DELAY=${UPDATE_RETRY_DELAY}
HEALTH_ATTEMPTS=${HEALTH_ATTEMPTS}
HEALTH_RETRY_DELAY=${HEALTH_RETRY_DELAY}
AUTO_DEPLOY_INTERVAL=${AUTO_DEPLOY_INTERVAL}
EOF
  chmod 600 /etc/digitalisierungsplanung-auto-deploy.env

  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Digitalisierungsplanung atomic Git auto deploy
After=network-online.target nginx.service
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=-/etc/digitalisierungsplanung-auto-deploy.env
ExecStart=/bin/bash ${APP_DIR}/server/auto-deploy.sh --once
TimeoutStartSec=20min
EOF

  cat > "/etc/systemd/system/${SERVICE_NAME}.timer" <<EOF
[Unit]
Description=Check Digitalisierungsplanung main for a tested release

[Timer]
OnBootSec=30s
OnUnitInactiveSec=${AUTO_DEPLOY_INTERVAL}
RandomizedDelaySec=10s
Persistent=true
Unit=${SERVICE_NAME}.service

[Install]
WantedBy=timers.target
EOF

  systemctl daemon-reload
  systemctl enable --now "${SERVICE_NAME}.timer"
  systemctl start --no-block "${SERVICE_NAME}.service"
  log "Installed. The server checks origin/${BRANCH} every ${AUTO_DEPLOY_INTERVAL}."
  log "Status: systemctl status ${SERVICE_NAME}.timer"
  log "Logs: journalctl -u ${SERVICE_NAME}.service -n 100 --no-pager"
}

show_status() {
  printf 'marker: %s\n' "$MARKER_FILE"
  if [[ -f "$MARKER_FILE" ]]; then
    cat "$MARKER_FILE"
  else
    printf 'not deployed by auto-deploy yet\n'
  fi
  printf '\nlocal API:\n'
  curl -fsS http://127.0.0.1:8788/version || true
  printf '\n'
  systemctl --no-pager status "${SERVICE_NAME}.timer" 2>/dev/null || true
}

run_once() {
  require_root
  validate_settings
  require_runtime_commands
  mkdir -p "$STATE_DIR" "$(dirname "$LOCK_FILE")"
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    log "Another update is already running."
    return 0
  fi

  if [[ ! -d "$APP_DIR/.git" ]]; then
    printf '%s is not a Git checkout. Bootstrap with server/deploy.sh first.\n' "$APP_DIR" >&2
    return 1
  fi
  fetch_remote

  local target_ref="refs/remotes/origin/${BRANCH}"
  local target_commit target_release target_sequence target_built_at target_source_commit
  target_commit="$(git -C "$APP_DIR" rev-parse "$target_ref")"
  target_release="$(release_id_from_ref "$target_ref")"
  target_sequence="$(release_sequence_from_ref "$target_ref")"
  target_built_at="$(release_built_at_from_ref "$target_ref")"
  target_source_commit="$(release_source_commit_from_ref "$target_ref")"
  if [[ ! "$target_release" =~ ^release-[0-9]+$ || ! "$target_sequence" =~ ^[0-9]+$ ]]; then
    log "Remote main has no new tested release stamp yet. Waiting for CI."
    return 0
  fi

  local deployed_release deployed_commit
  deployed_release="$(marker_field RELEASE_ID)"
  deployed_commit="$(marker_field COMMIT)"

  if [[ "$deployed_release" == "$target_release" ]]; then
    if [[ -n "$deployed_commit" ]] && git -C "$APP_DIR" cat-file -e "${deployed_commit}^{commit}" 2>/dev/null; then
      local current_commit
      current_commit="$(git -C "$APP_DIR" rev-parse HEAD)"
      if [[ "$current_commit" != "$deployed_commit" || -n "$(git -C "$APP_DIR" status --porcelain)" ]]; then
        log "Restoring the server workspace to deployed commit ${deployed_commit}."
        sync_to_commit "$deployed_commit" tracked
      fi
    fi
    if verify_release "$deployed_release"; then
      if [[ "$target_commit" != "$deployed_commit" ]]; then
        log "Remote code changed but release ${target_release} did not. Waiting for the green CI release stamp."
      else
        log "${deployed_release} is already healthy."
      fi
      return 0
    fi
    log "${deployed_release} is marked deployed but unhealthy; redeploying it."
    local redeploy_commit="$deployed_commit"
    if [[ -z "$redeploy_commit" ]] || ! git -C "$APP_DIR" cat-file -e "${redeploy_commit}^{commit}" 2>/dev/null; then
      redeploy_commit="$target_commit"
    fi
    sync_to_commit "$redeploy_commit" full
    prepare_deploy_runner "$redeploy_commit"
    if deploy_checked_out_release "$deployed_release"; then
      return 0
    fi
    return 1
  fi

  log "New tested release ${target_release} at ${target_commit}; currently ${deployed_release:-unmanaged}."
  sync_to_commit "$target_commit" full
  prepare_deploy_runner "$target_commit"
  if deploy_checked_out_release "$target_release"; then
    write_marker "$target_release" "$target_sequence" "$target_commit" "$target_built_at" "$target_source_commit"
    log "Deployment complete: ${target_release}."
    return 0
  fi

  recover_services
  log "Deployment of ${target_release} failed. Marker remains on ${deployed_release:-none}; the timer will retry this green release."
  printf 'Update failed. Inspect journalctl and PM2 if the retry does not recover.\n' >&2
  return 1
}

case "${1:---once}" in
  --once)
    run_once
    ;;
  --install)
    install_systemd
    ;;
  --status)
    show_status
    ;;
  *)
    printf 'Usage: %s [--once|--install|--status]\n' "$0" >&2
    exit 2
    ;;
esac
