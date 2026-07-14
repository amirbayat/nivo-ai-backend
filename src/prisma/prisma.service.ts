import { Injectable, OnModuleInit } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    // docs/PERFORMANCE-AND-CONCURRENCY.md بخش ۳ — قبلاً روی پیش‌فرض ضمنی pg (۱۰ کانکشن) بود.
    // ۲۰ به‌عنوان پیش‌فرض جدید — بدون PgBouncer هنوز، پس زیر سقف max_connections واقعی
    // Postgres (پیش‌فرض ۱۰۰، مشترک با هر اتصال دیگری مثل migration/psql/مانیتورینگ) نگه داشته
    // می‌شود. بعد از مهاجرت به Managed DBaaS + PgBouncer (بخش ۱۰.۳)، این عدد دیگر محدودیت واقعی
    // نیست و می‌تواند بر اساس تعداد replica بالاتر هم برود.
    super({
      adapter: new PrismaPg({
        connectionString: process.env['DATABASE_URL'],
        max: Number(process.env['DATABASE_POOL_SIZE'] ?? 20),
      }),
    })
  }

  async onModuleInit() {
    await this.$connect()
  }
}
