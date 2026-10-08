#!/usr/bin/env bash
# ROYAL RED Docker entrypoint (Phase A): create the database on first boot,
# then hand off to the standalone Next.js server.
set -eu

DB_PATH="${DATA_DIR:-/data}/royal-red.db"

mkdir -p "${DATA_DIR:-/data}/workspace" "${DATA_DIR:-/data}/box"

if [ ! -f "$DB_PATH" ]; then
  echo "royal-red boot: creating the database schema at $DB_PATH"
  bun docker/apply-schema.ts "$DB_PATH"
else
  echo "royal-red boot: database found, starting"
fi

exec bun .next/standalone/server.js
