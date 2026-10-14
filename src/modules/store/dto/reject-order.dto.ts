import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ToNumber } from '../../../common/decorators/digits.decorators';

export class RejectOrderDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsBoolean()
  moneyReceived?: boolean;

  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(1)
  refundAmountToman?: number;
}
