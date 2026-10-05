import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MaxLength,
} from 'class-validator';
import { ContentChangeSource, GoldWageType } from '@prisma/client';
import { fa } from '../../../i18n/fa';

// docs/PRD-product-strategy-and-roadmap.md بخش ۳.۲ — فیلدهای ساختاریافته‌ی سطح فروشگاه،
// همه اختیاری (partial update، هیچ فیلدی اجباری برای پرکردن نیست)
export class UpdateStoreDto {
  // docs/PRD-seller-guide-assistant-modal.md بخش ۱.۲ — قبلاً فقط در CreateStoreDto بود؛ برای
  // اعمال‌کردن پیشنهاد دسته‌بندی از تحلیل یادداشت خام، باید بعد از ثبت‌نام هم قابل ویرایش باشد
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: fa.validation.stringTooLong })
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: fa.validation.stringTooLong })
  shippingInfo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: fa.validation.stringTooLong })
  returnPolicy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300, { message: fa.validation.stringTooLong })
  brandIntro?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: fa.store.invalidTimeFormat })
  workingHoursStart?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: fa.store.invalidTimeFormat })
  workingHoursEnd?: string;

  // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۰ بند ۴
  @IsOptional()
  @IsBoolean()
  postPurchaseFollowUpEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  abandonedCartReminderEnabled?: boolean;

  // docs/PRD-sales-agent-persuasion-principles.md بخش ۶ — کلید کلی فروشنده برای ۶ اصل
  // متقاعدسازی در FULL_AGENT؛ هم‌خانواده‌ی دو فیلد بالا
  @IsOptional()
  @IsBoolean()
  persuasionTechniquesEnabled?: boolean;

  // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۱ — false یعنی فروش حضوری/
  // دیجیتال (کلاً ADDRESS_COLLECTION رد می‌شود)
  @IsOptional()
  @IsBoolean()
  requiresShipping?: boolean;

  // docs/PRD-seller-guide-assistant-modal.md بخش ۱.۲ — متن خام فروشنده؛ هم مستقیم دستی
  // قابل‌ویرایش است (textarea مستقل) هم از تحلیل یادداشت append می‌شود
  @IsOptional()
  @IsString()
  @MaxLength(20000, { message: fa.validation.stringTooLong })
  ownerNotes?: string;

  // docs/PRD-seller-guide-assistant-modal.md بخش ۱.۳ — فقط برای لاگ تغییرات محتوا؛ خودِ
  // Store این فیلد را ندارد، در سرویس قبل از persist حذف می‌شود
  @IsOptional()
  @IsEnum(ContentChangeSource)
  source?: ContentChangeSource;

  // docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۳.۳ — اجرت/سود/مالیات
  // طلا، یک‌بار برای کل فروشگاه (نه به‌ازای هر محصول)
  @IsOptional()
  @IsEnum(GoldWageType)
  goldWageType?: GoldWageType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  goldWageValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  goldProfitPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  goldVatPercent?: number;
}
