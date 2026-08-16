import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateGrowthConfigDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  welcomeDiscountPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  welcomeDiscountValidHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  expiryDiscountPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  referralDiscountPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  referralDiscountValidDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  postTrialGraceHours?: number;
}
