import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

// city قابل تغییر نیست (یعنی یک ردیف دیگر بسازید) — فقط هزینه/فعال‌بودن
export class UpdateShippingRuleDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  cost?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
