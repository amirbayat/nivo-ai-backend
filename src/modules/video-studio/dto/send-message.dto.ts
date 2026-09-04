import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

export class SendMessageDto {
  @IsString()
  @MinLength(1, { message: fa.validation.required })
  @MaxLength(2000, { message: fa.validation.stringTooLong })
  content: string;

  // کلید MinIO عکس مرجعی که کاربر ضمیمه کرده («این عکس رو برام ویدیو کن») — از
  // POST /video-studio/upload-image گرفته می‌شود؛ فقط وقتی intent نهایی generate_quick_video
  // باشد استفاده می‌شود (video-studio.service.ts/sendMessage)
  @IsOptional()
  @IsString()
  imageKey?: string;
}
