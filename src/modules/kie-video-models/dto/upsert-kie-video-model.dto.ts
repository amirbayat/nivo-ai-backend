import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { KieInputSchema, KieVideoCategory, VideoModelProvider } from '@prisma/client';

const CATEGORIES = Object.values(KieVideoCategory);
const PROVIDERS = Object.values(VideoModelProvider);
const KIE_INPUT_SCHEMAS = Object.values(KieInputSchema);

// برای هر دو create/update استفاده می‌شود — همه‌ی فیلدها اینجا اختیاری‌اند، سرویس تصمیم
// می‌گیرد کدام‌ها برای create اجباری‌اند (slug/displayName/category)
export class UpsertKieVideoModelDto {
  // پیش‌فرض KIE در کنترلر اعمال می‌شود (نه اینجا) تا این DTO برای update هم قابل‌استفاده بماند
  @IsOptional()
  @IsIn(PROVIDERS)
  provider?: VideoModelProvider;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: KieVideoCategory;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  supportsImages?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxImages?: number;

  @IsOptional()
  @IsBoolean()
  supportsVideo?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxVideoDurationSec?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxVideoWindowSec?: number;

  @IsOptional()
  @IsBoolean()
  supportsAspectRatio?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsDuration?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  resolutions?: string[];

  @IsOptional()
  pricePerSecondUsdConfirmed?: number;

  @IsOptional()
  @IsString()
  pricingNote?: string;

  // فقط برای provider=KIE معنا دارد — تعیین می‌کند کدام builder در video-edit.processor.ts
  // صدا زده شود (Omni/Seedance/Wan V2V/Wan R2V/Wan VideoEdit)
  @IsOptional()
  @IsIn(KIE_INPUT_SCHEMAS)
  kieInputSchema?: KieInputSchema;

  @IsOptional()
  @IsBoolean()
  supportsScenePreservingEdit?: boolean;

  // خالی = duration پیوسته (config.generateFixedDurationSec)؛ پر = چیپ‌های مدت با همین
  // مقادیر دقیق (مثلاً Wan V2V فقط [5,10] را قبول می‌کند)
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  fixedDurations?: number[];

  // معماری data-driven (input-fields.schema.ts) — عمداً اینجا فقط unknown و IsOptional است؛
  // اعتبارسنجی کامل ساختاری (zod) داخل KieVideoModelsService انجام می‌شود، نه اینجا، چون
  // shape واقعی یک union عمیق و بازگشتی است که class-validator برایش مناسب نیست.
  // null = پاک‌کردن عمدی (بازگشت به معماری قدیمی)؛ undefined = این فیلد اصلاً دست‌نخورده بماند.
  @IsOptional()
  inputFields?: unknown;
}
