import { IsEnum, IsInt, IsNumber, IsOptional, Min } from 'class-validator';
import { PricingGenerationType } from '@prisma/client';
import { ToNumber } from '../../../common/decorators/digits.decorators';

export class UpdatePricingTierDto {
  @IsOptional()
  @IsEnum(PricingGenerationType)
  type?: PricingGenerationType;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ToNumber()
  minToman?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ToNumber()
  maxToman?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ToNumber()
  markup?: number;
}
