import { ArrayNotEmpty, IsArray, IsEnum, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator'
import { PushCampaignSegment } from '@prisma/client'
import { fa } from '../../../i18n/fa'

export class SendPushNotificationDto {
  @IsString({ message: fa.validation.required })
  @IsNotEmpty({ message: fa.validation.required })
  @MaxLength(100, { message: fa.validation.stringTooLong })
  title: string

  @IsString({ message: fa.validation.required })
  @IsNotEmpty({ message: fa.validation.required })
  @MaxLength(500, { message: fa.validation.stringTooLong })
  body: string

  @IsEnum(PushCampaignSegment, { message: fa.validation.required })
  segment: PushCampaignSegment

  // فقط وقتی segment = PHONE_LIST الزامی است
  @ValidateIf((dto) => dto.segment === PushCampaignSegment.PHONE_LIST)
  @IsArray({ message: fa.validation.mustBeArray })
  @ArrayNotEmpty({ message: fa.validation.required })
  @IsString({ each: true, message: fa.validation.required })
  phoneList?: string[]
}
