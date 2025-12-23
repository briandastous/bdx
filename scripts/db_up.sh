#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.local}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required (set it in $ENV_FILE or export it)." >&2
  exit 1
fi

db_url_port="$(
  node - <<'NODE'
const url = new URL(process.env.DATABASE_URL);
process.stdout.write(url.port || "5432");
NODE
)"

if [[ -n "${DB_PORT:-}" && "${DB_PORT}" != "${db_url_port}" ]]; then
  echo "DB_PORT (${DB_PORT}) does not match DATABASE_URL port (${db_url_port})." >&2
  echo "Update DATABASE_URL (recommended) or align DB_PORT to match." >&2
  exit 1
fi

DB_PORT="${DB_PORT:-$db_url_port}"

echo "Starting Postgres via docker compose (DB_PORT=${DB_PORT})."
DB_PORT="${DB_PORT}" docker compose up -d db
