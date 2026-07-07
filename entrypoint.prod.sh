#!/bin/sh
set -e

# دیتابیس پروداکشن دیگر توسط این اسکریپت تغییر نمی‌کند.
# schema و seed ها باید دستی اجرا شوند — به back-end/prisma/MANUAL_DB_CHANGES.md مراجعه کنید.

echo ">>> [1/1] Generating Prisma client..."
npx prisma generate

echo ">>> Starting NestJS in production mode..."
exec node dist/src/main
