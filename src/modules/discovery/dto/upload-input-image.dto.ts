import { IsString } from 'class-validator'
import { fa } from '../../../i18n/fa'

// تک عکس ورودی کاربر برای سبک‌های requiresUserImage=true — قبل از generate آپلود می‌شود
// (data URL base64، دقیقاً هم‌فرمت StreamMessageDto.images) و کلید MinIO برگشتی داخل
// GenerateCreativeDto.inputImageKeys فرستاده می‌شود. اعتبارسنجی فرمت/حجم/magic-bytes واقعی
// توی DiscoveryGenerationService.uploadInputImage با همون validateChatImages چت انجام می‌شود.
export class UploadDiscoveryImageDto {
  @IsString({ message: fa.validation.required })
  image: string
}
