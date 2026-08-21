import { IsString, MaxLength, MinLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

// اسم دلخواه کاربر برای یک پرامپت استخراج‌شده‌ی خودش (تبدیل عکس به پرامپت)
export class RenameExtractionDto {
  @IsString({ message: fa.validation.required })
  @MinLength(1, { message: fa.validation.required })
  @MaxLength(60, { message: fa.validation.stringTooLong })
  title: string;
}
