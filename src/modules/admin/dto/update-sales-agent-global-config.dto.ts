import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
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
}
