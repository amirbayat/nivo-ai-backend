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

// docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۲ (فاز ۱.۵) — برخلاف نسخه‌ی قبلی
// (city غیرقابل‌تغییر)، provinces حالا قابل ویرایش است: فروشنده می‌تواند چک‌باکس استان‌های یک
// ردیف را هر وقت خواست عوض کند؛ «آخرین انتخاب برنده است» در StoreShippingRuleService.update
export class UpdateShippingRuleDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(IRAN_PROVINCES, { each: true })
  provinces?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  cost?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
