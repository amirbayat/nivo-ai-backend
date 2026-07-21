import { IsBoolean, IsIn, IsOptional, IsString, IsArray, ArrayMaxSize, MaxLength } from 'class-validator'
import { fa } from '../../../i18n/fa'

export class StreamMessageDto {
  @IsString({ message: fa.validation.required })
  @MaxLength(10_000, { message: fa.validation.stringTooLong })
  content: string

  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(50, { message: fa.validation.stringTooLong })
  model?: string

  // دراپ‌دون «سریع/هوشمند» کنار ارسال پیام — فقط روی reasoning effort اثر می‌گذارد، نه انتخاب
  // مدل (که همچنان دست ModelRouterService است). خالی = رفتار قبلی (reasoningEffort پیش‌فرض پلن/استپ بودجه‌ای)
  @IsOptional()
  @IsIn(['fast', 'smart'], { message: fa.validation.required })
  thinkingMode?: 'fast' | 'smart'

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  images?: string[]

  // docs/PRD-chat-images.md بخش ۵.۵ — حالت صریح تولید عکس؛ content همان prompt تولید است.
  // وقتی true است، model باید یک مدل supportsImageGen مشخص باشد (نه 'optimal')
  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  generateImage?: boolean
}
