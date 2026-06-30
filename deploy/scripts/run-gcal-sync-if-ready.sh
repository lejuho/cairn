#!/usr/bin/env bash
set -Eeuo pipefail

REPO_DIR="${REPO_DIR:-/home/pi/cairn}"
ENV_FILE="${ENV_FILE:-/home/pi/cairn-data/cairn-server.env}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
fi

DB_PATH="${DB_PATH:-/home/pi/cairn-data/cairn.sqlite3}"
CAIRN_DB_PATH="${CAIRN_DB_PATH:-$DB_PATH}"
CAIRN_TOKEN_PATH="${CAIRN_TOKEN_PATH:-$REPO_DIR/.cairn/gcal-token.json}"

if [[ -z "${GCAL_CLIENT_ID:-}" || -z "${GCAL_CLIENT_SECRET:-}" ]]; then
  printf 'GCal sync skipped: GCAL_CLIENT_ID/GCAL_CLIENT_SECRET not configured in %s\n' "$ENV_FILE"
  exit 0
fi

if [[ ! -f "$CAIRN_TOKEN_PATH" ]]; then
  printf 'GCal sync skipped: token file missing at %s. Run pnpm gcal:auth first.\n' "$CAIRN_TOKEN_PATH"
  exit 0
fi

export CAIRN_DB_PATH
export CAIRN_TOKEN_PATH

cd "$REPO_DIR"
exec corepack pnpm gcal:sync
