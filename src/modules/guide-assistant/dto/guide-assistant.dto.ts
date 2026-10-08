import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// docs/PRD-seller-guide-assistant-modal.md بخش ۳ — این چت پرسیست نمی‌شود (۲.۳)، پس هر درخواست
// باید کل تاریخچه + سیستم‌پرامپت را خودش حمل کند (فرانت buildGuidePrompt موجود را همان‌جا
// می‌سازد و این‌جا فقط اجرا می‌شود — دوباره‌نویسی منطق کلاستر/دسته‌بندی در بک‌اند لازم نیست)
export class GuideAssistantMessageDto {
  @IsIn(['user', 'assistant'])
  role: 'user' | 'assistant';

  @IsString()
  @MaxLength(8000)
  content: string;
}

export class GuideAssistantStreamDto {
  @IsString()
  @MaxLength(6000)
  systemPrompt: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => GuideAssistantMessageDto)
  messages: GuideAssistantMessageDto[];

  // کلید pool (model-variants.ts)، نه اسم مدل واقعی — یک‌بار در شروع جلسه از پاسخ اول backend
  // گرفته می‌شود و در درخواست‌های بعدی همین جلسه عیناً برگردانده می‌شود تا مدل ثابت بماند
  @IsOptional()
  @IsString()
  modelVariant?: string;
}

export class GuideAssistantTtsDto {
  @IsString()
  @MaxLength(4000)
  text: string;
}
