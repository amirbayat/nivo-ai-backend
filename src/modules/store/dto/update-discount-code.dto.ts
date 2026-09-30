import { IsBoolean, IsOptional } from 'class-validator';

// docs/PRD-customer-comments-and-discounts.md بخش ۸ — فروشنده فقط می‌تواند فعال/غیرفعال کند
// (نه ویرایش مقدار/نوع یک کد که ممکن است در گفتگوهای جاری/سفارش‌های قبلی مرجع شده باشد)
export class UpdateDiscountCodeDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
