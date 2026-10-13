import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { fa } from '../../../i18n/fa';
import { EnDigits, ToNumber } from '../../../common/decorators/digits.decorators';

export class RefundDestinationDto {
  @IsString({ message: fa.validation.required })
  @MinLength(8, { message: fa.order.refundDestinationInvalid })
  @MaxLength(40, { message: fa.validation.stringTooLong })
  @EnDigits()
  destination: string;

  @IsString({ message: fa.validation.required })
  @MinLength(2, { message: fa.order.refundHolderInvalid })
  @MaxLength(80, { message: fa.validation.stringTooLong })
  holderName: string;
}

export class OrderIssueDto {
  @IsIn(['NOT_RECEIVED', 'DAMAGED', 'WRONG_ITEM', 'OTHER'], {
    message: fa.order.issueReasonInvalid,
  })
  reason: 'NOT_RECEIVED' | 'DAMAGED' | 'WRONG_ITEM' | 'OTHER';

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: fa.validation.stringTooLong })
  text?: string;
}

export class MarkRefundPaidDto {
  @IsOptional()
  @IsString()
  @MaxLength(64, { message: fa.validation.stringTooLong })
  @EnDigits()
  paidRef?: string;
}

export class CreateRefundDto {
  @IsString()
  orderId: string;

  @IsIn(['ITEM_UNAVAILABLE', 'OVERPAID', 'RETURNED', 'OTHER'])
  reason: 'ITEM_UNAVAILABLE' | 'OVERPAID' | 'RETURNED' | 'OTHER';

  @ToNumber()
  @IsInt({ message: fa.order.refundAmountInvalid })
  @Min(1, { message: fa.order.refundAmountInvalid })
  @Max(1_000_000_000, { message: fa.order.refundAmountInvalid })
  amountToman: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
