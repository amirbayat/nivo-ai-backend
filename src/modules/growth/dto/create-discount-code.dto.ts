import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ToNumber } from '../../../common/decorators/digits.decorators';

export class CreateDiscountCodeDto {
  @IsInt()
  @Min(1)
  @Max(100)
  @ToNumber()
  discountPercent: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @ToNumber()
  maxUses?: number;

  @IsOptional()
  @IsString()
  expiresAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  codeSuffix?: string;
}
