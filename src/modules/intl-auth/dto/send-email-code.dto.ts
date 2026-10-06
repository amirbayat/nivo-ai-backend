import { IsEmail, IsString } from 'class-validator';
import { en } from '../../../i18n/en';

export class SendEmailCodeDto {
  @IsString({ message: en.validation.required })
  @IsEmail({}, { message: en.validation.emailInvalid })
  email: string;
}
