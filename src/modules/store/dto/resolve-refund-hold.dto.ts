import { IsBoolean } from 'class-validator';

export class ResolveRefundHoldDto {
  @IsBoolean()
  moneyReceived: boolean;
}
