import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateCaptionPricingTierDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  maxDurationSec?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  creditCost?: number;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
