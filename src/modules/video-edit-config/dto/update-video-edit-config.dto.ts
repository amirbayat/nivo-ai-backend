import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateVideoEditConfigDto {
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  generateFixedDurationSec?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxConcurrentJobsPerUser?: number;

  // null = بدون سقف روزانه — کلاینت باید صراحتاً null بفرستد تا سقف برداشته شود
  @IsOptional()
  @IsInt()
  @Min(1)
  maxJobsPerDayPerUser?: number | null;
}
