import { Transform } from 'class-transformer'
import { IsString, Length, Matches } from 'class-validator'
import { fa } from '../../../i18n/fa'
import { toEnglishDigits } from '../../../common/utils/normalize-digits'

export class VerifyOtpDto {
  @Transform(({ value }) => (typeof value === 'string' ? toEnglishDigits(value) : value))
  @IsString({ message: fa.validation.required })
  @Matches(/^(\+98|0)?9[0-9]{9}$/, { message: fa.validation.phoneInvalid })
  phone: string

  @Transform(({ value }) => (typeof value === 'string' ? toEnglishDigits(value) : value))
  @IsString({ message: fa.validation.required })
  @Length(6, 6, { message: fa.validation.otpLength })
  @Matches(/^[0-9]{6}$/, { message: fa.validation.otpDigitsOnly })
  code: string
}
