import { IsEnum, IsInt, IsNumber, IsOptional, Min } from 'class-validator';
import { PricingGenerationType } from '@prisma/client';

export class CreatePricingTierDto {
  @IsEnum(PricingGenerationType)
  type: PricingGenerationType;

  @IsInt()
  @Min(0)
  minToman: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxToman?: number | null;

  @IsNumber()
  @Min(0)
  markup: number;
}
