import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ContentChangeSource, GoldWageType } from '@prisma/client';
import { fa } from '../../../i18n/fa';
import {
  EnDigits,
  ToNumber,
} from '../../../common/decorators/digits.decorators';

// docs/PRD-product-strategy-and-roadmap.md بخش ۳.۲ — فیلدهای ساختاریافته‌ی سطح فروشگاه،
// همه اختیاری (partial update، هیچ فیلدی اجباری برای پرکردن نیست)
export class UpdateStoreDto {
  // SP-2 §4.9 «/store/info» — نام و لینک فروشگاه؛ قفل بودن slug بعد از اولین مشتری واقعی در
  // StoreService.update چک می‌شود
  @IsOptional()
  @IsString()
  @MinLength(2, { message: fa.validation.required })
  @MaxLength(60, { message: fa.validation.stringTooLong })
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{3,40}$/, { message: fa.store.slugInvalid })
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: fa.validation.stringTooLong })
  instagramUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: fa.validation.stringTooLong })
  telegramUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: fa.validation.stringTooLong })
  websiteUrl?: string;

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

  // R3.3 — بازه‌ی روز کاری ارسال (null یعنی پاک‌کردن)؛ جفت‌بودن و min ≤ max در StoreService.update
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  @ToNumber()
  shippingDaysMin?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  @ToNumber()
  shippingDaysMax?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: fa.validation.stringTooLong })
  returnPolicy?: string;

  // docs/PRD-leadgen-store-rich-brand-intro.md — سقف واقعی اینجا فقط یک سقفِ سخت ضدِ سوءاستفاده‌ست
  // (۲۰۰۰)؛ سقف واقعی روزمره (۳۰۰ عادی / ۲۰۰۰ برای leadCaptureOnly) در StoreService.update چک
  // می‌شود چون آنجا وضعیت فعلی leadCaptureOnly فروشگاه در دسترس است، نه اینجا
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: fa.validation.stringTooLong })
  brandIntro?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: fa.store.invalidTimeFormat })
  @EnDigits()
  workingHoursStart?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: fa.store.invalidTimeFormat })
  @EnDigits()
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

  // فیدبک کاربر ۱۴۰۵/۰۷/۱۸ — سوئیچ خاموش/روشن وویس ربات؛ دیفالت اولیه خاموش (هر وویس
  // ۱۰۰۰-۲۰۰۰ تومان هزینه‌ی واقعی دارد)
  @IsOptional()
  @IsBoolean()
  voiceRepliesEnabled?: boolean;

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
  @ToNumber()
  goldWageValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @ToNumber()
  goldProfitPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @ToNumber()
  goldVatPercent?: number;

  // docs/PRD-buyer-payment-method-card-or-snapppay-link.md بخش ۵ — نال/خالی یعنی این روش
  // پرداخت غیرفعال است؛ فقط دامنه‌ی رسمی اسنپ‌پی یا کوتاه‌کننده‌ی رسمی‌شان پذیرفته می‌شود
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: fa.validation.stringTooLong })
  @Matches(/^https:\/\/(snapppay\.ir|l\.snpy\.ir)\//, {
    message: fa.store.invalidSnapppayLink,
  })
  snapppayPaymentLink?: string;
}
