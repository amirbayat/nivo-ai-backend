import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsString() DATABASE_URL: string;
  @IsString() REDIS_URL: string;

  @IsString() JWT_SECRET: string;
  @IsString() JWT_EXPIRES_IN: string;
  @IsString() JWT_REFRESH_SECRET: string;
  @IsString() JWT_REFRESH_EXPIRES_IN: string;

  @IsUrl({ require_tld: false }) LIARA_AI_BASE_URL: string;
  @IsString() LIARA_API_KEY: string;

  // docs/PRD-openrouter-migration.md §۶.۱ + docs/EXECUTION-PLAN.md قدم ۱ — سوییچ provider.
  // عمداً همه اختیاری با default امن: بدون ست‌کردن هیچ‌کدام، AI_PROVIDER معادل «liara» فرض
  // می‌شود و رفتار فعلی پروداکشن دست‌نخورده می‌ماند. برگشت به لیارا از هر لحظه = همین یک متغیر.
  @IsOptional() @IsIn(['liara', 'openrouter']) AI_PROVIDER?: string;
  @IsOptional() @IsString() OPENROUTER_API_KEY?: string;
  @IsOptional()
  @IsUrl({ require_tld: false })
  OPENROUTER_BASE_URL?: string;
  @IsOptional() @IsString() OPENROUTER_SITE_URL?: string;
  @IsOptional() @IsString() OPENROUTER_APP_NAME?: string;
  // پروکسی اختیاری فقط برای ترافیک OpenRouter (مثلاً یک HTTP(S) proxy روی سروری خارج از ایران) —
  // برای دورزدن connect-timeout به IP های Cloudflare که OpenRouter پشتشان سرو می‌شود. فرمت:
  // http://user:pass@host:port — ai-provider.service.ts این را می‌خواند (AiProviderService.fetch)
  @IsOptional() @IsUrl({ require_tld: false }) OPENROUTER_PROXY_URL?: string;
  // secret مشترک با openrouter-relay (پروژه‌ی جدا، دیپلوی‌شده روی سروری خارج از ایران) —
  // وقتی OPENROUTER_BASE_URL به دامنه‌ی relay اشاره می‌کند، این مقدار به‌صورت هدر
  // X-Relay-Secret به هر درخواست اضافه می‌شود تا relay فقط به بک‌اند خودمان جواب بدهد.
  @IsOptional() @IsString() OPENROUTER_RELAY_SECRET?: string;

  // docs/PRD-telegram-bot-channel.md — بات مشترک تلگرام (فاز۲ multichannel). عمداً اختیاری:
  // قبل از ساخت بات واقعی با BotFather، بدون این‌ها فقط وبهوک تلگرام رد می‌شود (verifySecret
  // false)، بقیه‌ی بک‌اند بی‌اثر از این نیست.
  @IsOptional() @IsString() TELEGRAM_BOT_TOKEN?: string;
  @IsOptional() @IsString() TELEGRAM_WEBHOOK_SECRET?: string;

  // docs/PRD-sales-agent-voice.md بخش ۱.۱ — مدل TTS روی Kie.ai (زیرساخت KieProviderService
  // موجود، همان relay). اسلاگ توسط کاربر مستقیم از kie.ai تایید شد: google/gemini-3-8-flash-lite-tts
  // (نسخه‌ی lite، نه نسخه‌ی کامل که سند اولیه فرض کرده بود).
  @IsOptional() @IsString() KIE_TTS_MODEL_SLUG?: string;

  // docs/PRD-liara-usage-reconciliation.md — رصد مصرف واقعی هر کاربر با کلید اختصاصی روی لیارا.
  // عمداً اختیاری: بدون این‌ها provisioning fail می‌شود و chat بی‌صدا روی LIARA_API_KEY مشترک
  // fallback می‌کند — دیپلوی فعلی بدون ست‌کردنشان نباید بشکند.
  @IsOptional() @IsString() LIARA_MANAGEMENT_JWT?: string;
  @IsOptional() @IsString() LIARA_WORKSPACE_NAME?: string;
  @IsOptional()
  @IsUrl({ require_tld: false })
  LIARA_MANAGEMENT_BASE_URL?: string;
  @IsOptional() @IsString() LIARA_KEY_ENCRYPTION_SECRET?: string;

  @IsString() ZARINPAL_MERCHANT_ID: string;
  @IsString() KAVENEGAR_API_KEY: string;

  @IsUrl({ require_tld: false }) APP_URL: string;
  @IsUrl({ require_tld: false }) API_URL: string;

  // پوش FCM اپ موبایل ادمین (docs/PRD-admin-notifications-and-mobile.md بخش ۵) — عمداً اختیاری،
  // بدون آن فقط پوش غیرفعال می‌ماند، بقیه‌ی سیستم (لیست/polling) بدون آن هم کار می‌کند
  @IsOptional() @IsString() FIREBASE_SERVICE_ACCOUNT?: string;

  // گزارش خطا به Sentry (instrument.ts) — عمداً اختیاری: بدون این var، Sentry.init
  // اصلاً صدا زده نمی‌شود و بقیه‌ی اپ بدون تغییر کار می‌کند (مثلاً روی dev/local).
  @IsOptional() @IsString() SENTRY_DSN?: string;
  @IsOptional() @IsString() SENTRY_ENVIRONMENT?: string;

  // docs/PRD-gold-silver-price-ticker.md — قیمت طلا برای فروشنده‌های طلا. عمداً اختیاری:
  // بدون آن فقط رفرش قیمت غیرفعال می‌ماند (لاگ WARN) و GET /market-prices/gold آرایه‌ی
  // خالی برمی‌گرداند، بقیه‌ی اپ طبیعی کار می‌کند.
  @IsOptional() @IsString() BRSAPI_API_KEY?: string;

  // docs/PRD-instagram-smart-dm-and-ir-intl-split.md بخش ۳ — کدام دیپلوی: ایران (دارکوب، موجود)
  // یا خارجی (آلمان، nivoai.site، تازه). عمداً اختیاری با پیش‌فرض IR تا دیپلوی فعلی دست‌نخورده بماند.
  @IsOptional() @IsIn(['IR', 'INTL']) REGION?: string;

  // بخش ۷.۱ — کد تایید ایمیلی فروشنده‌ی REGION=INTL (آینه‌ی SEND_SMS/Kavenegar بالا برای SMS).
  // بدون SEND_EMAIL=true، کد فقط لاگ می‌شود (devMode)، هیچ ایمیل واقعی ارسال نمی‌شود — دقیقاً
  // همون الگوی sms.service.ts. SMTP عمومی (نه یک provider خاص) چون هنوز provider نهایی مشخص نیست.
  @IsOptional() @IsString() SEND_EMAIL?: string;
  @IsOptional() @IsString() SMTP_HOST?: string;
  @IsOptional() @IsInt() SMTP_PORT?: number;
  @IsOptional() @IsString() SMTP_USER?: string;
  @IsOptional() @IsString() SMTP_PASS?: string;
  @IsOptional() @IsString() SMTP_FROM?: string;

  // بخش ۴.۱/۷.۲ — اتصال Instagram API with Instagram Login. عمداً اختیاری (مثل
  // TELEGRAM_BOT_TOKEN بالا): قبل از ساخت App واقعی در Meta Developer، وبهوک/OAuth فقط رد
  // می‌شوند، بقیه‌ی بک‌اند بی‌اثر از این نیست.
  @IsOptional() @IsString() INSTAGRAM_APP_ID?: string;
  @IsOptional() @IsString() INSTAGRAM_APP_SECRET?: string;
  @IsOptional() @IsString() INSTAGRAM_WEBHOOK_VERIFY_TOKEN?: string;
  @IsOptional() @IsUrl({ require_tld: false }) INSTAGRAM_REDIRECT_URI?: string;

  @IsInt() @Min(1) PORT: number = 3001;
}

export function validate(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validated;
}
