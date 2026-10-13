import { IsEmail, IsString, Length, Matches } from 'class-validator';
import { en } from '../../../i18n/en';
import { EnDigits } from '../../../common/decorators/digits.decorators';

export class VerifyEmailCodeDto {
  @IsString({ message: en.validation.required })
  @IsEmail({}, { message: en.validation.emailInvalid })
  email: string;

  @IsString({ message: en.validation.required })
  @Length(6, 6, { message: en.validation.codeLength })
  @Matches(/^[0-9]{6}$/, { message: en.validation.codeDigitsOnly })
  @EnDigits()
  code: string;
}
