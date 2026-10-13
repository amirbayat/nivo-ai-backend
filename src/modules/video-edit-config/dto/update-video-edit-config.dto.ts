import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ToNumber } from '../../../common/decorators/digits.decorators';

export class UpdateVideoEditConfigDto {
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  @ToNumber()
  generateFixedDurationSec?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  @ToNumber()
  maxConcurrentJobsPerUser?: number;

  // null = بدون سقف روزانه — کلاینت باید صراحتاً null بفرستد تا سقف برداشته شود
  @IsOptional()
  @IsInt()
  @Min(1)
  @ToNumber()
  maxJobsPerDayPerUser?: number | null;
}
