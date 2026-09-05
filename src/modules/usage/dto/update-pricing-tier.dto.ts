import { IsEnum, IsInt, IsNumber, IsOptional, Min } from 'class-validator';
import { PricingGenerationType } from '@prisma/client';

export class UpdatePricingTierDto {
  @IsOptional()
  @IsEnum(PricingGenerationType)
  type?: PricingGenerationType;

  @IsOptional()
  @IsInt()
  @Min(0)
  minToman?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxToman?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  markup?: number;
}
