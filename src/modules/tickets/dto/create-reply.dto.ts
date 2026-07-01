import { IsNotEmpty, IsString, MaxLength } from 'class-validator'
import { fa } from '../../../i18n/fa'

export class CreateReplyDto {
  @IsString({ message: fa.validation.required })
  @IsNotEmpty({ message: fa.validation.required })
  @MaxLength(5000, { message: fa.validation.stringTooLong })
  body: string
}
