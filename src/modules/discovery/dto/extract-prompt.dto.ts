import { IsString } from 'class-validator';
import { fa } from '../../../i18n/fa';

// کلید MinIO عکسی که قبلاً با POST /v2/discovery/upload-image آپلود شده — همان کلید
// اینجا برای «تبدیل عکس به پرامپت» دوباره استفاده می‌شود
export class ExtractPromptDto {
  @IsString({ message: fa.validation.required })
  imageKey: string;
}
