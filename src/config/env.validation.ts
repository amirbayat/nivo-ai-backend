import { plainToInstance } from 'class-transformer'
import { IsInt, IsOptional, IsString, IsUrl, Min, validateSync } from 'class-validator'

class EnvironmentVariables {
  @IsString() DATABASE_URL: string
  @IsString() REDIS_URL: string

  @IsString() JWT_SECRET: string
  @IsString() JWT_EXPIRES_IN: string
  @IsString() JWT_REFRESH_SECRET: string
  @IsString() JWT_REFRESH_EXPIRES_IN: string

  @IsUrl({ require_tld: false }) LIARA_AI_BASE_URL: string
  @IsString() LIARA_API_KEY: string

  // docs/PRD-liara-usage-reconciliation.md — رصد مصرف واقعی هر کاربر با کلید اختصاصی روی لیارا.
  // عمداً اختیاری: بدون این‌ها provisioning fail می‌شود و chat بی‌صدا روی LIARA_API_KEY مشترک
  // fallback می‌کند — دیپلوی فعلی بدون ست‌کردنشان نباید بشکند.
  @IsOptional() @IsString() LIARA_MANAGEMENT_JWT?: string
  @IsOptional() @IsString() LIARA_WORKSPACE_NAME?: string
  @IsOptional() @IsUrl({ require_tld: false }) LIARA_MANAGEMENT_BASE_URL?: string
  @IsOptional() @IsString() LIARA_KEY_ENCRYPTION_SECRET?: string

  @IsString() ZARINPAL_MERCHANT_ID: string
  @IsString() KAVENEGAR_API_KEY: string

  @IsUrl({ require_tld: false }) APP_URL: string
  @IsUrl({ require_tld: false }) API_URL: string

  // پوش FCM اپ موبایل ادمین (docs/PRD-admin-notifications-and-mobile.md بخش ۵) — عمداً اختیاری،
  // بدون آن فقط پوش غیرفعال می‌ماند، بقیه‌ی سیستم (لیست/polling) بدون آن هم کار می‌کند
  @IsOptional() @IsString() FIREBASE_SERVICE_ACCOUNT?: string

  @IsInt() @Min(1) PORT: number = 3001
}

export function validate(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  })
  const errors = validateSync(validated, { skipMissingProperties: false })
  if (errors.length > 0) {
    throw new Error(errors.toString())
  }
  return validated
}
