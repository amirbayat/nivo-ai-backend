import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';
import { fa } from '../../../i18n/fa';

// docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۶.۵ — سه عدد مارکت‌پلیس
// sales-agent، جدا از CreditConfig (که مال ویجت نیوو/nivoai.ir است)
export class UpdateSalesAgentGlobalConfigDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  freeDailyQuota?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  trialDurationDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  trialCreditToman?: number;

  // فیدبک کاربر ۱۴۰۵/۰۷/۱۷ — ضریب روی هزینه‌ی خام AI قبل از کسر از اعتبار فروشگاه
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  buyerCostMarkup?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  sellerCostMarkup?: number;

  // فیدبک کاربر ۱۴۰۵/۰۷/۱۷ — فقط برای برآورد نمایشی «حدود N چت» روی کارت‌های خرید اعتبار
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  avgCostPerChatToman?: number;
}
