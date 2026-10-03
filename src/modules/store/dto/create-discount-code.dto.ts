import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import type { DiscountKind } from '@prisma/client';
import { fa } from '../../../i18n/fa';

// docs/PRD-customer-comments-and-discounts.md بخش ۷/۸
export class CreateDiscountCodeDto {
  @IsString({ message: fa.validation.required })
  @Matches(/^[A-Za-z0-9]{3,20}$/, {
    message: fa.store.discountCodeInvalidFormat,
  })
  code: string;

  @IsIn(['PERCENT', 'FIXED_AMOUNT'], { message: fa.validation.required })
  kind: DiscountKind;

  @IsInt()
  @Min(1)
  value: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  // docs/PRD-seller-growth-tools-and-marketplace-trust.md بخش ۵ مورد ۵ — تخفیف پلکانی
  // («۳ عدد بخر، ۱۰٪ تخفیف»)؛ خالی = بدون حداقل تعداد
  @IsOptional()
  @IsInt()
  @Min(2)
  minQuantity?: number;
}
