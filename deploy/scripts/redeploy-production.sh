#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Usage: deploy/scripts/redeploy-production.sh [options]

Redeploy Cairn on the Raspberry Pi production host.

Options:
  --skip-pull       Do not run git pull --ff-only.
  --skip-install    Do not run corepack pnpm install --frozen-lockfile.
  --skip-verify     Do not run corepack pnpm verify.
  --skip-migrate    Do not run corepack pnpm db:migrate.
  --skip-caddy      Do not reload the caddy service.
  -h, --help        Show this help.

Environment overrides:
  REPO_DIR          Default: /home/pi/cairn
  ENV_FILE          Default: /home/pi/cairn-data/cairn-server.env
  DB_PATH           Default: /home/pi/cairn-data/cairn.sqlite3
  CAIRN_DB_PATH     Default: $DB_PATH
  STATIC_ROOT       Default: /var/www/cairn
  SERVER_SERVICE    Default: cairn-server
  CADDY_SERVICE     Default: caddy
USAGE
}

log() {
  printf '\n==> %s\n' "$*"
}

run() {
  printf '+'
  printf ' %q' "$@"
  printf '\n'
  "$@"
}

check_health() {
  local url="$1"
  local body
  local attempt

  for attempt in $(seq 1 30); do
    if body="$(curl -fsS "$url" 2>/dev/null)"; then
      printf '%s\n' "$body"

      if [[ "$body" == *'"ok":true'* ]]; then
        return 0
      fi

      printf 'Health check failed: %s did not return ok=true\n' "$url" >&2
      exit 1
    fi

    sleep 1
  done

  printf 'Health check failed: %s did not respond after 30s\n' "$url" >&2
  exit 1
}

SKIP_PULL=0
SKIP_INSTALL=0
SKIP_VERIFY=0
SKIP_MIGRATE=0
SKIP_CADDY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-pull) SKIP_PULL=1 ;;
    --skip-install) SKIP_INSTALL=1 ;;
    --skip-verify) SKIP_VERIFY=1 ;;
    --skip-migrate) SKIP_MIGRATE=1 ;;
    --skip-caddy) SKIP_CADDY=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

REPO_DIR="${REPO_DIR:-/home/pi/cairn}"
ENV_FILE="${ENV_FILE:-/home/pi/cairn-data/cairn-server.env}"
SERVER_SERVICE="${SERVER_SERVICE:-cairn-server}"
CADDY_SERVICE="${CADDY_SERVICE:-caddy}"
STATIC_ROOT="${STATIC_ROOT:-/var/www/cairn}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
fi

DB_PATH="${DB_PATH:-/home/pi/cairn-data/cairn.sqlite3}"
CAIRN_DB_PATH="${CAIRN_DB_PATH:-$DB_PATH}"

log "Repository"
run cd "$REPO_DIR"

if [[ "$SKIP_PULL" -ne 1 ]]; then
  log "Pull latest code"
  run git pull --ff-only
fi

if [[ "$SKIP_INSTALL" -ne 1 ]]; then
  log "Install dependencies"
  run corepack pnpm install --frozen-lockfile
fi

if [[ "$SKIP_VERIFY" -ne 1 ]]; then
  log "Verify"
  run corepack pnpm verify
fi

log "Build"
run corepack pnpm build

log "Publish static web assets"
run sudo mkdir -p "$STATIC_ROOT"
run sudo rsync -a --delete "$REPO_DIR/web/dist/" "$STATIC_ROOT/"
run sudo chown -R caddy:caddy "$STATIC_ROOT"

if [[ "$SKIP_MIGRATE" -ne 1 ]]; then
  log "Migrate production database"
  run env CAIRN_DB_PATH="$CAIRN_DB_PATH" corepack pnpm db:migrate
fi

log "Restart Fastify server"
run sudo systemctl restart "$SERVER_SERVICE"
run systemctl is-active --quiet "$SERVER_SERVICE"

if [[ "$SKIP_CADDY" -ne 1 ]]; then
  log "Reload Caddy"
  run sudo systemctl reload "$CADDY_SERVICE"
  run systemctl is-active --quiet "$CADDY_SERVICE"
fi

log "Smoke checks"
check_health "http://127.0.0.1:3100/health"
check_health "http://localhost:18080/health"

log "Done"
printf 'Open: https://cairn.lee-blog.me/today\n'
