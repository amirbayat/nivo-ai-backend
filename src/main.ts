import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'

// docs/PRD-chat-images.md بخش ۵.۲ — قبلاً هیچ override ای اینجا نبود (سقف پیش‌فرض
// express روی این مقدار نبود، بدون هیچ هماهنگی مشخصی با سقف ۲۰ مگابایتی nginx در پروداکشن)؛
// عکس‌های چت base64 هستند (~۳۳٪ حجم بیشتر از بایت واقعی) پس باید زیر سقف nginx ولی
// به‌اندازه‌ی کافی بزرگ برای چند عکس در یک پیام باشد.
const BODY_SIZE_LIMIT = '15mb'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false })
  app.useBodyParser('json', { limit: BODY_SIZE_LIMIT })
  app.useBodyParser('urlencoded', { limit: BODY_SIZE_LIMIT, extended: true })

  // مسیرهای مقالات عمداً بدون پیشوند api/v1 هستند — این‌ها آدرس‌های عمومی SEO
  // هستند (docs/PRD-articles-seo-blog.md)، نه endpoint های API.
  app.setGlobalPrefix('api/v1', {
    exclude: ['blog', 'blog/(.*)'],
  })

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )

  // AllExceptionsFilter از این‌جا حذف شد — چون حالا برای دریافت LiveStatsService از طریق DI
  // به APP_FILTER نیاز دارد (رجیستر شده در app.module.ts)، نه instantiate دستی که DI ندارد.

  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174').split(',')
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  })

  await app.listen(process.env.PORT ?? 3000)
}
bootstrap()
