#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations..."
# Retry until MySQL is reachable and migrations apply.
n=0
until npx prisma migrate deploy; do
  n=$((n + 1))
  if [ "$n" -ge 30 ]; then
    echo "[entrypoint] migrate deploy failed after 30 attempts, aborting."
    exit 1
  fi
  echo "[entrypoint] DB not ready yet (attempt $n), retrying in 3s..."
  sleep 3
done

echo "[entrypoint] Seeding baseline data (idempotent)..."
npm run seed || echo "[entrypoint] seed step reported a non-zero exit (continuing)."

echo "[entrypoint] Starting Next.js server..."
exec npm run start -- -H 0.0.0.0 -p 3000
