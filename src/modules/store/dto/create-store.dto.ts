import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

// گام ۰ سند PRD-mvp-launch-plan.md — قدم ۱و۲ ویزارد ثبت‌نام فروشنده
export class CreateStoreDto {
  @IsString({ message: fa.validation.required })
  @MaxLength(60, { message: fa.validation.stringTooLong })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(60, { message: fa.validation.stringTooLong })
  category?: string;

  // انگلیسی، انتخاب خود فروشنده — بخش nivo.ai/chat/<slug> (بخش ۱.۱ سند)
  @IsString({ message: fa.validation.required })
  @Matches(/^[a-z0-9-]{3,40}$/, { message: fa.store.slugInvalid })
  slug: string;

  @IsString({ message: fa.validation.required })
  @Matches(/^[0-9]{16}$/, { message: fa.store.bankCardInvalid })
  bankCardNumber: string;

  @IsString({ message: fa.validation.required })
  @MaxLength(60, { message: fa.validation.stringTooLong })
  bankOwnerName: string;

  // فیدبک اول پایلوت — اختیاری، عمداً بدون @IsUrl (فروشنده ممکن است «@nam-shop» یا
  // «t.me/xxx» بدون https:// بنویسد؛ اعتبارسنجی سخت‌گیر فقط ورودی معتبر را رد می‌کند)
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
}
