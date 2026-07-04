import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'
import { FeedbackVote } from '@prisma/client'
import { fa } from '../../../i18n/fa'

export class SubmitMessageFeedbackDto {
  @IsEnum(FeedbackVote, { message: fa.validation.required })
  vote: FeedbackVote

  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(1000, { message: fa.validation.stringTooLong })
  comment?: string
}
