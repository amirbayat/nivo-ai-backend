#!/bin/sh
set -e

echo ">>> [1/4] Generating Prisma client..."
npx prisma generate

echo ">>> [2/4] Pushing database schema..."
npx prisma db push --accept-data-loss

echo ">>> [3/4] Seeding plans (upsert — safe to re-run)..."
npx ts-node --transpile-only prisma/seeds/plans.seed.ts

echo ">>> [4/4] Starting NestJS in production mode..."
exec node dist/main
