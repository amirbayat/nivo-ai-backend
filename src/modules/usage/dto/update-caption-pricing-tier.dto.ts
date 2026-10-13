import { IsInt, IsOptional, Min } from 'class-validator';
import { ToNumber } from '../../../common/decorators/digits.decorators';

export class UpdateCaptionPricingTierDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @ToNumber()
  maxDurationSec?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ToNumber()
  creditCost?: number;

  @IsOptional()
  @IsInt()
  @ToNumber()
  sortOrder?: number;
}
