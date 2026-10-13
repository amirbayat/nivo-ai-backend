import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ORDER_CARRIERS } from '../../../common/constants/sales-ops.constants';
import { toEnglishDigits } from '../../../common/utils/normalize-digits';
import { fa } from '../../../i18n/fa';

// docs/PRD-nivo-sales-unified.md 3.5 — فرم «ارسال شد»: شرکت حمل (لیست ثابت) + کد رهگیری
// (اختیاری، مثلاً برای پیک). هر دو اختیاری‌اند تا کلاینت قدیمی (بدون بدنه) هم کار کند.
export class ShipOrderDto {
  @IsOptional()
  @IsIn([...ORDER_CARRIERS], { message: fa.order.carrierInvalid })
  carrier?: string;

  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(64, { message: fa.validation.stringTooLong })
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? toEnglishDigits(value).trim() : value,
  )
  trackingCode?: string;
}
