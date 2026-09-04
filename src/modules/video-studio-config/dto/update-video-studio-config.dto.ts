import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateVideoStudioConfigDto {
  // چند گزینه‌ی هم‌زمان کاراکتر تولید شود (طراحی تایید‌شده: ۴) — ادمین می‌تواند تغییر دهد؛
  // هزینه‌ی هر ۴ (یا هر عددی که اینجا باشد) عکس از کاربر کسر می‌شود، نه فقط انتخاب‌شده
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  characterOptionCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxCharacterRegeneratesPerProject?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxConcurrentVideoJobsPerUser?: number;

  // null = بدون سقف روزانه — کلاینت باید صراحتاً null بفرستد تا سقف برداشته شود
  @IsOptional()
  @IsInt()
  @Min(1)
  maxVideoGenPerDayPerUser?: number | null;

  @IsOptional()
  @IsBoolean()
  defaultAudioEnabled?: boolean;
}
