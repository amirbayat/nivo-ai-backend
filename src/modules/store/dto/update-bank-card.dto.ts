import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';
import { fa } from '../../../i18n/fa';

// docs/PRD-seller-multi-bank-card-rotation.md بخش ۳ — cardNumber عمداً قابل‌ویرایش نیست؛
// اگر شماره‌کارت عوض شد، کارت قبلی غیرفعال و یک کارت جدید اضافه می‌شود (تاریخچه‌ی
// totalConfirmedToman/Order.bankCardId دست‌نخورده می‌ماند)
export class UpdateBankCardDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(60, { message: fa.validation.stringTooLong })
  ownerName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  thresholdToman?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  percentWeight?: number;
}
