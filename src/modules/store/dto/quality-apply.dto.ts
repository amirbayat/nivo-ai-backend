import { IsString, MaxLength, MinLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

// PQ-3 / SQ-3 — جواب فروشنده به یک پیشنهاد کیفیت (متن یا خروجی میکروفون)
export class QualityApplyDto {
  @IsString()
  @MaxLength(60)
  key!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(1500, { message: fa.validation.stringTooLong })
  answer!: string;
}
