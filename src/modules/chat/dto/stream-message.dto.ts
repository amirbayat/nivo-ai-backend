import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsArray,
  ArrayMaxSize,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { fa } from '../../../i18n/fa';

// docs/PRD-chat-files-and-pdf.md بخش ۳ — یک فایل غیرعکس پیوست‌شده از فرانت. data یک data URL
// خام است (مثل images)؛ filename فقط برای نمایش/چیپ و انتخاب پارسر استفاده می‌شود (magic bytes
// واقعی سمت سرور دوباره چک می‌شود، chat-file.validator.ts — به filename اعتماد امنیتی نمی‌شود)
export class ChatFileInputDto {
  @IsString({ message: fa.validation.required })
  data: string;

  @IsString({ message: fa.validation.required })
  @MaxLength(255, { message: fa.validation.stringTooLong })
  filename: string;
}

export class StreamMessageDto {
  @IsString({ message: fa.validation.required })
  @MaxLength(10_000, { message: fa.validation.stringTooLong })
  content: string;

  // مدل متنی/چت — همان انتخاب بالای چت (مثلاً 'cost_optimized'). فقط برای مسیر چت معمولی
  // (Router متنی) و vision استفاده می‌شود؛ برای تولید/ویرایش عکس از `imageModel` استفاده کن
  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(50, { message: fa.validation.stringTooLong })
  model?: string;

  // مدل تولید/ویرایش عکس — جدا از `model`. همیشه از فرانت فرستاده می‌شود (پین‌شده در صفحه‌ی
  // «انتخاب مدل» یا خالی = پیش‌فرض پلن)؛ فقط وقتی بک‌اند (explicit toggle یا classifyImageIntent)
  // تشخیص دهد این پیام باید عکس تولید/ویرایش کند استفاده می‌شود
  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(50, { message: fa.validation.stringTooLong })
  imageModel?: string;

  // دراپ‌دون «سریع/هوشمند» کنار ارسال پیام — فقط روی reasoning effort اثر می‌گذارد، نه انتخاب
  // مدل (که همچنان دست ModelRouterService است). خالی = رفتار قبلی (reasoningEffort پیش‌فرض پلن/استپ بودجه‌ای)
  @IsOptional()
  @IsIn(['fast', 'smart'], { message: fa.validation.required })
  thinkingMode?: 'fast' | 'smart';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  images?: string[];

  // docs/PRD-chat-models-web-search-and-files.md — توگل globe کنار دکمه‌ی ارسال؛ پیش‌فرض
  // false/خالی (خاموش). فقط وقتی مدل نهایی‌شده supportsWebSearch=true دارد واقعاً اعمال می‌شود
  // (chat.service.ts) — اگر مدل انتخابی پشتیبانی نکند، بی‌صدا نادیده گرفته می‌شود (نه خطا)
  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  webSearch?: boolean;

  // docs/PRD-chat-files-and-pdf.md بخش ۳ — پیوست فایل غیرعکس (PDF/DOCX/TXT/CSV/XLSX/کد).
  // هر آیتم یک data URL خام (مثل images بالا) + نام اصلی فایل برای نمایش/چیپ در پیام
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ChatFileInputDto)
  files?: ChatFileInputDto[];

  // docs/PRD-chat-images.md بخش ۵.۵ — حالت صریح تولید عکس؛ content همان prompt تولید است.
  // وقتی true است، imageModel (یا در غیاب آن، model) باید یک مدل supportsImageGen مشخص باشد
  // (نه یکی از سنتینل‌های خودکار 'optimal'/'cost_optimized'/'best_answer')
  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  generateImage?: boolean;

  // سوییچ «تغییر ندادن چهره» (فرانت: MessageInput.tsx) — فقط وقتی همراه با ویرایش عکس
  // پیوست‌شده (images غیرخالی) معنا دارد؛ پیش‌فرض روشن، یعنی نبودش هم یعنی true
  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  preserveFace?: boolean;

  // انتخاب اختیاری نسبت تصویر توسط کاربر (استودیو عکس) — خالی یعنی رفتار قبلی (اندازه‌ی
  // ثابت مدل انتخابی، یا در حالت auto حدس خودکار از روی متن). وقتی ست باشد، این همیشه
  // اندازه‌ی نهایی ارسالی به provider را override می‌کند، صرف‌نظر از مدل انتخاب‌شده.
  @IsOptional()
  @IsIn(['1:1', '16:9', '9:16'], { message: fa.validation.required })
  imageAspectRatio?: '1:1' | '16:9' | '9:16';
}
