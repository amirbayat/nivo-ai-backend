import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';
import { PricingModel } from '@prisma/client';
import { fa } from '../../../i18n/fa';
import type { ProductSpecItem } from '../product-specs.types';

// گام ۰ سند PRD-mvp-launch-plan.md — قدم ۳ ویزارد ثبت‌نام فروشنده (فقط محصول تکی، بدون واریانت/عکس)
export class CreateProductDto {
  @IsString({ message: fa.validation.required })
  @MaxLength(200, { message: fa.validation.stringTooLong })
  name: string;

  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  basePrice: number;

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

  // docs/PRD-sales-agent-persuasion-principles.md بخش ۶ — فرم پنل فروشنده همیشه این فیلد را
  // می‌فرستد (حتی در ساخت محصول تازه)، پس باید اینجا هم whitelist باشد وگرنه ValidationPipe
  // (forbidNonWhitelisted) درخواست را رد می‌کند
  @IsOptional()
  @IsBoolean()
  persuasionTechniquesEnabled?: boolean;

  // فرم SellerProductEditPage.tsx برای ساخت و ویرایش محصول از همون dto مشترک استفاده می‌کند
  // و specs را همیشه می‌فرستد (حتی null وقتی خالی است) — باید مثل UpdateProductDto whitelist شود
  @IsOptional()
  @IsArray()
  specs?: ProductSpecItem[] | null;

  // docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۲/۳ — وقتی
  // WEIGHT_BASED_FORMULA باشد basePrice نادیده گرفته می‌شود و weightGrams/purityKarat الزامی
  // می‌شوند (اعتبارسنجی در store.service.ts، نه اینجا — تا شرطی‌بودن ساده بماند)
  @IsOptional()
  @IsEnum(PricingModel)
  pricingModel?: PricingModel;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: fa.validation.numberPositive })
  weightGrams?: number;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  purityKarat?: number;
}
