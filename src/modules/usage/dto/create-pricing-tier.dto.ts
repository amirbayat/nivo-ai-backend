import { IsEnum, IsInt, IsNumber, IsOptional, Min } from 'class-validator';
import { PricingGenerationType } from '@prisma/client';
import { ToNumber } from '../../../common/decorators/digits.decorators';

export class CreatePricingTierDto {
  @IsEnum(PricingGenerationType)
  type: PricingGenerationType;

  @IsInt()
  @Min(0)
  @ToNumber()
  minToman: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ToNumber()
  maxToman?: number | null;

  @IsNumber()
  @Min(0)
  @ToNumber()
  markup: number;
}
