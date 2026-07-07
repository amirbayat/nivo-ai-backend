# تغییرات دیتابیس پروداکشن — فقط دستی

از این به بعد هیچ دیپلوی/entrypoint‌ای به صورت خودکار روی دیتابیس پروداکشن `prisma db push`, `prisma migrate deploy` یا seed اجرا نمی‌کند
(`back-end/entrypoint.prod.sh` فقط `prisma generate` و `start` را اجرا می‌کند).

## وقتی schema.prisma تغییر می‌کند

1. تغییر را در `prisma/schema.prisma` اعمال کن.
2. یک فایل SQL دیف بساز که فقط تغییرات لازم را دارد، نه کل schema:

   ```bash
   npx prisma migrate diff \
     --from-url "$DATABASE_URL" \
     --to-schema-datamodel prisma/schema.prisma \
     --script > prisma/manual-migrations/<YYYYMMDD>_<توضیح-کوتاه>.sql
   ```

   (`--from-url` باید به یک دیتابیس با schema فعلی/قبلی وصل شود — مثلاً دیتابیس local که با آخرین schema اعمال‌شده sync است.)

3. فایل SQL تولید شده را قبل از اجرا بازبینی کن (مخصوصاً برای `DROP COLUMN`/`DROP TABLE`/تغییر type که می‌تواند data loss داشته باشد).
4. فایل را مستقیم روی دیتابیس پروداکشن اجرا کن (مثلاً `psql $DATABASE_URL -f prisma/manual-migrations/xxx.sql` یا از طریق DB client).
5. بعد از تایید اجرای موفق روی پروداکشن، دیپلوی کد جدید را انجام بده.

## Seed ها

Seed ها (`prisma/seeds/*.seed.ts`) دیگر در `entrypoint.prod.sh` اجرا نمی‌شوند. برای اجرای دستی روی پروداکشن:

```bash
docker compose -f docker-compose.prod.yml exec -T backend \
  npx ts-node --transpile-only prisma/seeds/<name>.seed.ts
```

## محیط dev / local

این محدودیت فقط برای پروداکشن است. `back-end/entrypoint.sh` (که برای `docker-compose.yml` معمولی استفاده می‌شود) همچنان `prisma db push` و seed ها را خودکار اجرا می‌کند — چون روی دیتابیس local/dev ریسکی ندارد.
