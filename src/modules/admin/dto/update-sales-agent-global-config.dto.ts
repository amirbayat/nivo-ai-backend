import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, Min } from 'class-validator';
import { fa } from '../../../i18n/fa';
import { VARIANT_KEYS } from '../../sales-agent/model-variants';
import { ToNumber } from '../../../common/decorators/digits.decorators';

// docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۶.۵ — سه عدد مارکت‌پلیس
// sales-agent، جدا از CreditConfig (که مال ویجت نیوو/nivoai.ir است)
export class UpdateSalesAgentGlobalConfigDto {
  // R1.2 — kill switch هوش مصنوعی
  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  freeDailyQuota?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  trialDurationDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  @ToNumber()
  trialCreditToman?: number;

  // فیدبک کاربر ۱۴۰۵/۰۷/۱۷ — ضریب روی هزینه‌ی خام AI قبل از کسر از اعتبار فروشگاه
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  buyerCostMarkup?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  sellerCostMarkup?: number;

  // فیدبک کاربر ۱۴۰۵/۰۷/۱۷ — فقط برای برآورد نمایشی «حدود N چت» روی کارت‌های خرید اعتبار
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @ToNumber()
  avgCostPerChatToman?: number;

  // فیدبک کاربر ۱۴۰۵/۰۷/۱۷ — null/undefined = pool تصادفی (رفتار قبلی)؛ در غیر این صورت باید
  // یکی از کلیدهای فعلی MODEL_VARIANTS (model-variants.ts) باشد
  @IsOptional()
  @IsIn(VARIANT_KEYS, { message: fa.validation.invalidValue })
  forcedModelVariant?: string | null;
}
