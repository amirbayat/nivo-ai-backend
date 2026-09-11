import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { fa } from '../../../i18n/fa';

class ImagePromptReviewMessageDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(4000)
  content: string;
}

// stateless — کلاینت هر بار کل تاریخچه‌ی مکالمه‌ی مودال را می‌فرستد (بک‌اند چیزی ذخیره نمی‌کند).
// برخلاف video-edit (که رفرنس را با یک کلید MinIO می‌فرستد)، اینجا خودِ data URL خام عکس فرستاده
// می‌شود — دقیقاً همان چیزی که StreamMessageDto.images هم همین حالا قبول می‌کند و
// validateChatImages/normalizeHeicDataUrls (chat-image.validator.ts) همین حالا آن را اعتبارسنجی
// می‌کنند؛ عکس مرجع فقط در اولین درخواست هر گفتگو پر است (بخش ۳.۳)
export class CreateImagePromptReviewDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5) // همون سقف decorator-level خودِ StreamMessageDto.images؛ سقف واقعی/قابل‌تنظیم chatConfig.maxImagesPerMessage است (بخش ۳.۳)
  @IsString({ each: true, message: fa.validation.required })
  referenceImages?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImagePromptReviewMessageDto)
  messages: ImagePromptReviewMessageDto[];
}
