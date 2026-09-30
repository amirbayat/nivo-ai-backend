import { IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

// گام ۳ سند PRD-mvp-launch-plan.md — ویرایش سریع از تب «محصولات» پنل فروشنده
export class UpdateProductDto {
  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(120, { message: fa.validation.stringTooLong })
  name?: string;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  basePrice?: number;

  @IsOptional()
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(0, { message: fa.validation.numberPositive })
  stock?: number;

  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(2000, { message: fa.validation.stringTooLong })
  description?: string;

  // docs/PRD-telegram-bot-channel.md بخش ۹.۳ — کد کوتاه اختیاری روی محتوای تبلیغاتی فروشنده
  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(40, { message: fa.validation.stringTooLong })
  code?: string;
}
