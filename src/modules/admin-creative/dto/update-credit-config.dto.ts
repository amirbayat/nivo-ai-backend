import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { fa } from '../../../i18n/fa';
import { ToNumber } from '../../../common/decorators/digits.decorators';

// نرخ تبدیل + ضریب فروش + شارژ اولیه‌ی رایگان — همه از ادمین قابل‌تغییر (بخش ۵.۷/۳.۱)
export class UpdateCreditConfigDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  tomanPerCredit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  purchaseMarkup?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  @ToNumber()
  freeSignupCredits?: number;

  // پله‌های گرد‌کردن مصرف (PricingService.debitWallet) — هرکدام بین صفر و یک؛ ترتیب مهم نیست،
  // سمت مصرف قبل از استفاده صعودی‌سازی می‌شود
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsNumber({}, { each: true, message: fa.validation.mustBeNumber })
  @Min(0.01, { each: true, message: fa.validation.numberPositive })
  @Max(1, { each: true, message: fa.validation.numberPositive })
  @ToNumber()
  roundingSteps?: number[];

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
  @ToNumber()
  extractionEconomicalCreditCost?: number;

  @IsOptional()
  @IsString()
  extractionPremiumModel?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  @ToNumber()
  extractionPremiumCreditCost?: number;

  // نیوو اضافه‌ای که سوییچ کاربر «استفاده از عکس اصلی» (تولید از سبک‌های استخراج‌شده) کسر می‌کند
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  @ToNumber()
  sourceImageAccuracyCreditCost?: number;
}
