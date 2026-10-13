import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { fa } from '../../../i18n/fa';
import { EnDigits } from '../../../common/decorators/digits.decorators';

// docs/PRD-nivo-sales-unified.md 3.8 — «رسید ندارم/عکس نگرفتم»: ۴ رقم آخر کارت مبدا، ساعت
// تقریبی واریز و کد پیگیری (اختیاری). برای فروشنده با برچسب «بدون عکس — در بانک چک کن» می‌رود.
export class SubmitManualReceiptDto {
  @IsString({ message: fa.validation.required })
  @Matches(/^\d{4}$/, { message: fa.order.manualReceiptCardLast4Invalid })
  @EnDigits()
  cardLast4: string;

  @IsString({ message: fa.validation.required })
  @MaxLength(40, { message: fa.validation.stringTooLong })
  approxTime: string;

  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(64, { message: fa.validation.stringTooLong })
  @EnDigits()
  trackingCode?: string;
}
