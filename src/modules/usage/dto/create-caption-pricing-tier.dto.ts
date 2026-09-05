import { IsInt, IsOptional, Min } from 'class-validator';

export class CreateCaptionPricingTierDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  maxDurationSec?: number | null; // null = پله‌ی باز (بدون سقف)

  @IsInt()
  @Min(0)
  creditCost: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
