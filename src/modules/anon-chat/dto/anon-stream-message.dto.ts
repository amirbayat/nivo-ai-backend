import { IsString, MaxLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

export class AnonStreamMessageDto {
  @IsString({ message: fa.validation.required })
  @MaxLength(10_000, { message: fa.validation.stringTooLong })
  content: string;
}
