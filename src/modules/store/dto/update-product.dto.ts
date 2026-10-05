import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';
import { ContentChangeSource } from '@prisma/client';
import { fa } from '../../../i18n/fa';
import type { ProductSpecItem } from '../product-specs.types';

// گام ۳ سند PRD-mvp-launch-plan.md — ویرایش سریع از تب «محصولات» پنل فروشنده
export class UpdateProductDto {
  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(200, { message: fa.validation.stringTooLong })
  name?: string;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  basePrice?: number;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  stock?: number;

  // فیدبک کاربر ۱۴۰۵/۰۷/۰۱ — ۲۰۰۰ سقف قبلی کم بود؛ ۵۰۰۰ شد. این سقفِ ذخیره‌سازی است، نه
  // سقفِ توکن AI — conversation-engine.service.ts قبل از تزریق به facts جداگانه truncate می‌کند
  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(5000, { message: fa.validation.stringTooLong })
  description?: string;

  // docs/PRD-telegram-bot-channel.md بخش ۹.۳ — کد کوتاه اختیاری روی محتوای تبلیغاتی فروشنده
  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(40, { message: fa.validation.stringTooLong })
  code?: string;

  // docs/PRD-sales-agent-persuasion-principles.md بخش ۶ — کلید به‌ازای این محصول؛ حتی وقتی
  // فروشگاه روشن است، فروشنده می‌تواند این یک محصول را مستثنا کند
  @IsOptional()
  @IsBoolean()
  persuasionTechniquesEnabled?: boolean;

  // docs/PRD-seller-knowledge-base.md بخش ۹.۲ (سوم) — فروشنده می‌تواند پیشنهاد AI را (بعد از
  // اعمال محلی در فرم) مثل description با همین دکمه‌ی اصلی «ذخیره» persist کند؛ null برای پاک‌کردن
  @IsOptional()
  @IsArray()
  specs?: ProductSpecItem[] | null;

  // docs/PRD-seller-guide-assistant-modal.md بخش ۱.۲ — متن خام فروشنده درباره‌ی این محصول
  // (توضیح/تنوع/هرچیز دیگر)؛ هم دستی قابل‌ویرایش هم از تحلیل یادداشت append می‌شود
  @IsOptional()
  @IsString()
  @MaxLength(20000, { message: fa.validation.stringTooLong })
  ownerNotes?: string;

  // docs/PRD-seller-guide-assistant-modal.md بخش ۱.۳ — فقط برای لاگ تغییرات محتوا
  @IsOptional()
  @IsEnum(ContentChangeSource)
  source?: ContentChangeSource;
}
