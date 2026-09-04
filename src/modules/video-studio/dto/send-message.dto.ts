import { IsString, MaxLength, MinLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

export class SendMessageDto {
  @IsString()
  @MinLength(1, { message: fa.validation.required })
  @MaxLength(2000, { message: fa.validation.stringTooLong })
  content: string;
}
