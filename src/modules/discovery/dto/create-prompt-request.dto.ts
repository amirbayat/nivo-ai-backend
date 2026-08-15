import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator'
import { CreativeSegment } from '@prisma/client'
import { fa } from '../../../i18n/fa'

// «درخواست فیچر/سبک» — وقتی کاربر سبکی که می‌خواهد در دیسکاوری پیدا نمی‌کند
export class CreatePromptRequestDto {
  @IsOptional()
  @IsUUID(undefined, { message: fa.validation.required })
  promptId?: string // اگر مرتبط با یک کارت خاص است («دقیقاً این نیست که می‌خوام»)

  @IsString({ message: fa.validation.required })
  @MaxLength(120, { message: fa.validation.stringTooLong })
  title: string

  @IsString({ message: fa.validation.required })
  @MaxLength(2000, { message: fa.validation.stringTooLong })
  description: string

  @IsOptional()
  @IsEnum(CreativeSegment)
  platform?: CreativeSegment

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: fa.validation.stringTooLong })
  referenceUrl?: string
}
