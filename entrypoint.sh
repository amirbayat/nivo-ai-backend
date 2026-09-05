#!/bin/sh
set -e

echo ">>> Generating Prisma client..."
npx prisma generate

echo ">>> Pushing database schema..."
npx prisma db push

echo ">>> Seeding initial plans..."
npx ts-node --transpile-only prisma/seeds/plans.seed.ts

echo ">>> Seeding AI models..."
npx ts-node --transpile-only prisma/seeds/models.seed.ts

echo ">>> Seeding usage-analytics topics/segments..."
npx ts-node --transpile-only prisma/seeds/topics.seed.ts
npx ts-node --transpile-only prisma/seeds/segments.seed.ts

echo ">>> Seeding credit packages (نیوو)..."
npx ts-node --transpile-only prisma/seeds/credit-packages.seed.ts

echo ">>> Seeding pricing tiers (ضریب پله‌ای)..."
npx ts-node --transpile-only prisma/seeds/pricing-tiers.seed.ts

echo ">>> Seeding discovery category tree..."
npx ts-node --transpile-only prisma/seeds/creative-categories.seed.ts

echo ">>> Seeding sample discovery prompts..."
npx ts-node --transpile-only prisma/seeds/creative-prompts.seed.ts

echo ">>> Starting NestJS..."
exec npm run start:dev
