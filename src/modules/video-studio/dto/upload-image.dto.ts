import { IsString } from 'class-validator';
import { fa } from '../../../i18n/fa';

// تک عکس مرجع کاربر برای «این عکس رو برام ویدیو کن» — قبل از sendMessage آپلود می‌شود
// (data URL base64)؛ کلید MinIO برگشتی داخل SendMessageDto.imageKey فرستاده می‌شود.
// دقیقاً هم‌الگوی discovery/dto/upload-input-image.dto.ts
export class UploadVideoStudioImageDto {
  @IsString({ message: fa.validation.required })
  image: string;
}
