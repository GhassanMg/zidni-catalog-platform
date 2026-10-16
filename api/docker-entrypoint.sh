#!/bin/sh
set -e

# Apply pending migrations (Prisma takes an advisory lock, so concurrent replicas are safe).
npx prisma migrate deploy

# Demo data for local/evaluation environments. The seed is idempotent.
if [ "${SEED_ON_START:-false}" = "true" ]; then
  node dist/prisma/seed.js
fi

exec node dist/src/main.js
