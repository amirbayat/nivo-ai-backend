import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class SendBuyerOtpDto {
  @IsString()
  @Matches(/^(\+98|0)?9\d{9}$/)
  phone: string;
}

export class VerifyBuyerOtpDto {
  @IsString()
  @Matches(/^(\+98|0)?9\d{9}$/)
  phone: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;
}
