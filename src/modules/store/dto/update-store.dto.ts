import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { fa } from '../../../i18n/fa';

// docs/PRD-product-strategy-and-roadmap.md بخش ۳.۲ — فیلدهای ساختاریافته‌ی سطح فروشگاه،
// همه اختیاری (partial update، هیچ فیلدی اجباری برای پرکردن نیست)
export class UpdateStoreDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: fa.validation.stringTooLong })
  shippingInfo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: fa.validation.stringTooLong })
  returnPolicy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300, { message: fa.validation.stringTooLong })
  brandIntro?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: fa.store.invalidTimeFormat })
  workingHoursStart?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: fa.store.invalidTimeFormat })
  workingHoursEnd?: string;

  // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۰ بند ۴
  @IsOptional()
  @IsBoolean()
  postPurchaseFollowUpEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  abandonedCartReminderEnabled?: boolean;
}
