import { IsOptional, IsString, MaxLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

// عکس غذا به‌صورت data URL base64 — دقیقاً هم‌فرمت StreamMessageDto.images/UploadDiscoveryImageDto،
// اعتبارسنجی واقعی فرمت/حجم/magic-bytes در NivoCalService با همون validateChatImages چت انجام می‌شود
export class ScanFoodDto {
  @IsString({ message: fa.validation.required })
  image: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
