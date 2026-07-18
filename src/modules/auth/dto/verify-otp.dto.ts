import { Transform } from 'class-transformer'
import { IsOptional, IsString, Length, Matches } from 'class-validator'
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

  // docs/PRD-growth-traction-features.md بخش ۶.۳ — فقط روی اولین ثبت‌نام اثر دارد
  @IsOptional()
  @IsString({ message: fa.validation.required })
  referralCode?: string

  // docs/PRD-user-push-notifications-and-mobile-app-flows.md بخش ۵.۳ — اپ اندروید این را از
  // طریق NivoAndroidBridge.getDeviceUuid() به فرانت می‌دهد؛ برای وصل‌کردن توکن پوش ناشناس به این کاربر
  @IsOptional()
  @IsString({ message: fa.validation.required })
  deviceUuid?: string
}
