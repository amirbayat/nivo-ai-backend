import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class PromptReviewMessageDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(4000)
  content: string;
}

class ReferenceAssetDto {
  @IsIn(['image', 'video', 'audio'])
  type: 'image' | 'video' | 'audio';

  // کلید MinIO — همون چیزی که POST /video-edit/upload-image|video|audio برمی‌گرداند
  @IsString()
  key: string;
}

// stateless — کلاینت هر بار کل تاریخچه‌ی مکالمه‌ی مودال را می‌فرستد (بک‌اند چیزی ذخیره نمی‌کند).
// referenceAssets فقط در اولین درخواست هر گفتگو پر است (docs/PRD-video-prompt-coach.md بخش ۴.۴)؛
// درخواست‌های بعدی آن را خالی/حذف می‌فرستند — بک‌اند فایل‌های رسانه‌ای را فقط یک‌بار (همان پیام
// اول) به مدل می‌چسباند؛ برای سوال‌های تکمیلی مدل با تکیه بر متن نقد/پیشنهادی که خودش در همان
// تاریخچه قبلاً داده ادامه می‌دهد، نه با پردازش دوباره‌ی فایل خام (هم ارزان‌تر هم سریع‌تر است).
export class CreatePromptReviewDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReferenceAssetDto)
  referenceAssets?: ReferenceAssetDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromptReviewMessageDto)
  messages: PromptReviewMessageDto[];
}
