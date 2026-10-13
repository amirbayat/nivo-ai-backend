import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { EnDigits } from '../../../common/decorators/digits.decorators';

export class SendBuyerOtpDto {
  @IsString()
  @Matches(/^(\+98|0)?9\d{9}$/)
  @EnDigits()
  phone: string;
}

export class VerifyBuyerOtpDto {
  @IsString()
  @Matches(/^(\+98|0)?9\d{9}$/)
  @EnDigits()
  phone: string;

  @IsString()
  @Matches(/^\d{6}$/)
  @EnDigits()
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;
}
