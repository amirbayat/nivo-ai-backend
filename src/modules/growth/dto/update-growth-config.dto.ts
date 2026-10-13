import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ToNumber } from '../../../common/decorators/digits.decorators';

export class UpdateGrowthConfigDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @ToNumber()
  welcomeDiscountPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  @ToNumber()
  welcomeDiscountValidHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @ToNumber()
  expiryDiscountPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  @ToNumber()
  referralDiscountPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  @ToNumber()
  referralDiscountValidDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  @ToNumber()
  postTrialGraceHours?: number;
}
