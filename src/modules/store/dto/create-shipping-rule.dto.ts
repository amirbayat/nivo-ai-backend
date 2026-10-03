import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { IRAN_CITIES } from '../../../common/constants/iran-cities';
import { fa } from '../../../i18n/fa';

// docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۲ — city خالی/نبود = ردیف
// پیش‌فرض «سایر شهرها» (فقط یکی به‌ازای هر فروشگاه، اعمال‌شده در سرویس نه constraint دیتابیس)
export class CreateShippingRuleDto {
  @IsOptional()
  @IsIn(IRAN_CITIES, { message: fa.validation.required })
  city?: string;

  @IsInt()
  @Min(0)
  cost: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
