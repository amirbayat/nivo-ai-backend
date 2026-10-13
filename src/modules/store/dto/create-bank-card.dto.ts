import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { fa } from '../../../i18n/fa';
import {
  EnDigits,
  ToNumber,
} from '../../../common/decorators/digits.decorators';

// docs/PRD-seller-multi-bank-card-rotation.md بخش ۱
export class CreateBankCardDto {
  @IsString({ message: fa.validation.required })
  @Matches(/^[0-9]{16}$/, { message: fa.store.bankCardInvalid })
  @EnDigits()
  cardNumber: string;

  @IsString({ message: fa.validation.required })
  @MaxLength(60, { message: fa.validation.stringTooLong })
  ownerName: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ToNumber()
  sortOrder?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @ToNumber()
  thresholdToman?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @ToNumber()
  percentWeight?: number;
}
