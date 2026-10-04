import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

// docs/PRD-ai-assisted-business-setup.md بخش ۴ — قدم ۱ ویزارد ثبت‌نام، پیش از ساخت فروشگاه
export class ClassifyBusinessSetupDto {
  @IsString()
  @IsNotEmpty({ message: fa.store.businessSetupTextRequired })
  @MaxLength(2000, { message: fa.validation.stringTooLong })
  rawText: string;
}
