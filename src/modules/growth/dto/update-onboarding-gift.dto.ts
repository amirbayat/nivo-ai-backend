import { IsBoolean, IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdateOnboardingGiftDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUrl({}, { message: 'آدرس فایل صوتی معتبر نیست' })
  audioUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
