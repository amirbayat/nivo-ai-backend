// باید قبل از همه‌ی import های دیگر لود شود.
import './instrument';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

// docs/PRD-chat-images.md بخش ۵.۲ — قبلاً هیچ override ای اینجا نبود (سقف پیش‌فرض
// express روی این مقدار نبود، بدون هیچ هماهنگی مشخصی با سقف ۲۰ مگابایتی nginx در پروداکشن)؛
// عکس‌های چت base64 هستند (~۳۳٪ حجم بیشتر از بایت واقعی) پس باید زیر سقف nginx ولی
// به‌اندازه‌ی کافی بزرگ برای چند عکس در یک پیام باشد.
const BODY_SIZE_LIMIT = '20mb';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  // 0.10 — پشت ingress همروش؛ با trust proxy تعداد hopهای مورداعتماد، req.ip آدرس واقعی
  // کلاینت می‌شود و X-Forwarded-For جعلی سقف rate limit را دور نمی‌زند. اگر پشت Cloudflare
  // هم هستید TRUST_PROXY_HOPS=2 بگذارید (اگر کمتر از واقعیت باشد همه‌ی کاربران یک IP می‌شوند).
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
  // docs/PRD-instagram-smart-dm-and-ir-intl-split.md بخش ۷.۲ — وبهوک اینستاگرام امضای
  // X-Hub-Signature-256 را روی بایت خام بدنه چک می‌کند (نه JSON.parse شده دوباره)؛ verify
  // همین بافر را روی req.rawBody می‌گذارد، برای همه‌ی request ها (هزینه‌اش ناچیز است)
  app.useBodyParser('json', {
    limit: BODY_SIZE_LIMIT,
    verify: (req: { rawBody?: Buffer }, _res: unknown, buf: Buffer) => {
      req.rawBody = buf;
    },
  });
  app.useBodyParser('urlencoded', { limit: BODY_SIZE_LIMIT, extended: true });

  // مسیرهای مقالات عمداً بدون پیشوند api/v1 هستند — این‌ها آدرس‌های عمومی SEO
  // هستند (docs/PRD-articles-seo-blog.md)، نه endpoint های API.
  app.setGlobalPrefix('api/v1', {
    exclude: ['blog', 'blog/(.*)'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // AllExceptionsFilter از این‌جا حذف شد — چون حالا برای دریافت LiveStatsService از طریق DI
  // به APP_FILTER نیاز دارد (رجیستر شده در app.module.ts)، نه instantiate دستی که DI ندارد.

  const allowedOrigins = (
    process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174'
  ).split(',');
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
