import { Transform } from 'class-transformer'
import { IsString, Matches } from 'class-validator'
import { fa } from '../../../i18n/fa'
import { toEnglishDigits } from '../../../common/utils/normalize-digits'

export class SendOtpDto {
  @Transform(({ value }) => (typeof value === 'string' ? toEnglishDigits(value) : value))
  @IsString({ message: fa.validation.required })
  @Matches(/^(\+98|0)?9[0-9]{9}$/, { message: fa.validation.phoneInvalid })
  phone: string
}
