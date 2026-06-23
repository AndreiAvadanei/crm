#!/bin/sh
set -e

# Regenerate the Prisma client into the bind-mounted source tree so it stays in
# sync with the schema on every container start.
echo "[entrypoint:dev] Generating Prisma client..."
npx prisma generate

echo "[entrypoint:dev] Applying database migrations..."
# Retry until MySQL is reachable and migrations apply.
n=0
until npx prisma migrate deploy; do
  n=$((n + 1))
  if [ "$n" -ge 30 ]; then
    echo "[entrypoint:dev] migrate deploy failed after 30 attempts, aborting."
    exit 1
  fi
  echo "[entrypoint:dev] DB not ready yet (attempt $n), retrying in 3s..."
  sleep 3
done

echo "[entrypoint:dev] Seeding baseline data (idempotent)..."
npm run seed || echo "[entrypoint:dev] seed step reported a non-zero exit (continuing)."

echo "[entrypoint:dev] Starting Next.js dev server (hot reload)..."
exec npm run dev -- -H 0.0.0.0 -p 3000
