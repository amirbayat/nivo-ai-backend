import { IsString, MaxLength, MinLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

// جزئیات باقی‌مانده‌ی سناریو بعد از انتخاب کاراکتر (تعداد صحنه، دیالوگ/موسیقی، پایان‌بندی —
// طبق §۲ بند ۴ PRD) — یک متن آزاد فارسی که همراه initialPrompt پروژه به مدل چت داده می‌شود
// تا سناریو را به صحنه‌های مجزا بشکند.
export class GenerateStoryboardDto {
  @IsString()
  @MinLength(3, { message: fa.validation.required })
  @MaxLength(3000, { message: fa.validation.stringTooLong })
  details: string;
}
