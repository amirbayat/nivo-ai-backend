import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { fa } from '../../../i18n/fa';
import { EnDigits } from '../../../common/decorators/digits.decorators';

export class SendBuyerOtpDto {
  @IsString({ message: fa.validation.required })
  @Matches(/^(\+98|0)?9\d{9}$/, { message: fa.validation.phoneInvalid })
  @EnDigits()
  phone: string;
}

export class VerifyBuyerOtpDto {
  @IsString({ message: fa.validation.required })
  @Matches(/^(\+98|0)?9\d{9}$/, { message: fa.validation.phoneInvalid })
  @EnDigits()
  phone: string;

  @IsString({ message: fa.validation.required })
  @Matches(/^\d{6}$/, { message: fa.validation.otpLength })
  @EnDigits()
  code: string;

  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(100, { message: fa.validation.stringTooLong })
  fullName?: string;
}
