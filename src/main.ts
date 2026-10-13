// باید قبل از همه‌ی import های دیگر لود شود.
import './instrument';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { configureBodyParsers } from './common/http/body-parsers';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  // 0.10 — پشت ingress همروش؛ با trust proxy تعداد hopهای مورداعتماد، req.ip آدرس واقعی
  // کلاینت می‌شود و X-Forwarded-For جعلی سقف rate limit را دور نمی‌زند. اگر پشت Cloudflare
  // هم هستید TRUST_PROXY_HOPS=2 بگذارید (اگر کمتر از واقعیت باشد همه‌ی کاربران یک IP می‌شوند).
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
  // 2.6 — هدرهای امنیتی. CSP خاموش است چون صفحات HTML بلاگ (SSR) اسکریپت/استایل inline دارند
  // و این API است نه SPA؛ CORP باید cross-origin باشد چون فرانت‌ها (دامنه‌های دیگر) عکس/مدیا را
  // از همین سرور تعبیه می‌کنند.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  configureBodyParsers(app);

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
