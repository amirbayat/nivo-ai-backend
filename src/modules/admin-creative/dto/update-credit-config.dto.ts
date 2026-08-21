import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { fa } from '../../../i18n/fa';

// نرخ تبدیل + ضریب فروش + شارژ اولیه‌ی رایگان — همه از ادمین قابل‌تغییر (بخش ۵.۷/۳.۱)
export class UpdateCreditConfigDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  tomanPerCredit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  purchaseMarkup?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  freeSignupCredits?: number;

  // دو حالت خودکار «تبدیل عکس به پرامپت» — نام AiModel + قیمت ثابت به نیوو برای هرکدام.
  // null صریح یعنی «پاک کن، به انتخاب خودکار قدیمی برگرد» (فرانت وقتی Select خالی می‌شود همین
  // را می‌فرستد، نه undefined که از JSON حذف می‌شود و یعنی «بدون تغییر»)
  @IsOptional()
  @IsString()
  extractionEconomicalModel?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  extractionEconomicalCreditCost?: number;

  @IsOptional()
  @IsString()
  extractionPremiumModel?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  extractionPremiumCreditCost?: number;

  // نیوو اضافه‌ای که سوییچ کاربر «استفاده از عکس اصلی» (تولید از سبک‌های استخراج‌شده) کسر می‌کند
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  sourceImageAccuracyCreditCost?: number;
}
