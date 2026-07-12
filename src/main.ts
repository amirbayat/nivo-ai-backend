import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'
import { AllExceptionsFilter } from './common/filters/http-exception.filter'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

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

  app.useGlobalFilters(new AllExceptionsFilter())

  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174').split(',')
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  })

  await app.listen(process.env.PORT ?? 3000)
}
bootstrap()
