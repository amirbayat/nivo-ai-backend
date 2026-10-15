import { IsInt, IsString, Max, MaxLength, Min, MinLength, NotEquals } from 'class-validator';
import { ToNumber } from '../../../common/decorators/digits.decorators';

export const MAX_CREDIT_ADJUST_TOMAN = 50_000_000;

export class AdjustCreditDto {
  // منفی = کسر
  @ToNumber()
  @IsInt()
  @NotEquals(0)
  @Min(-MAX_CREDIT_ADJUST_TOMAN)
  @Max(MAX_CREDIT_ADJUST_TOMAN)
  amountToman!: number;

  @IsString()
  @MinLength(5)
  @MaxLength(200)
  reason!: string;
}
