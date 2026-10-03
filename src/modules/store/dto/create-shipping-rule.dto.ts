import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';
import { IRAN_PROVINCES } from '../../../common/constants/iran-provinces';

// docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۲ (فاز ۱.۵) — provinces خالی/نبود
// = ردیف پیش‌فرض «کل ایران» (فقط یکی به‌ازای هر فروشگاه، اعمال‌شده در سرویس نه constraint
// دیتابیس)؛ provinces غیرخالی یعنی این ردیف فقط همان استان‌ها را پوشش می‌دهد
export class CreateShippingRuleDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(IRAN_PROVINCES, { each: true })
  provinces?: string[];

  @IsInt()
  @Min(0)
  cost: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
