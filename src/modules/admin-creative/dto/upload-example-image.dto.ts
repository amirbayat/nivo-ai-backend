import { IsString } from 'class-validator';
import { fa } from '../../../i18n/fa';

// عکس نمونه‌ی سبک (CreativePrompt.exampleImageUrl) — آپلود از پنل ادمین، دقیقاً هم‌فرمت
// UploadDiscoveryImageDto (data URL base64). اعتبارسنجی واقعی فرمت/حجم/magic-bytes توی
// AdminCreativeService.uploadExampleImage با همون validateChatImages چت انجام می‌شود.
export class UploadExampleImageDto {
  @IsString({ message: fa.validation.required })
  image: string;
}
