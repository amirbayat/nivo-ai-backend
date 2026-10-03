// باید قبل از هر import دیگری در main.ts لود شود تا Sentry بتواند خطاهای early-boot
// را هم بگیرد. بدون SENTRY_DSN غیرفعال می‌ماند (مثلاً روی dev/local) — رفتار بقیه‌ی
// اپ را تغییر نمی‌دهد.
import * as Sentry from '@sentry/nestjs';

if (process.env.SENTRY_DSN) {
  // sendDefaultPii در @sentry/nestjs v11 حذف شده (دیتاکالکشن پیش‌فرض IP/هدرها/... را
  // از قبل فعال می‌کند) — نیازی به تنظیم دستی نیست.
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  });
}
