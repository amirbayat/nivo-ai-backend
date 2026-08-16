import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { fa } from '../../../i18n/fa';

export enum FeedbackCategory {
  FEATURE_REQUEST = 'FEATURE_REQUEST',
  BUG = 'BUG',
  UX = 'UX',
  PRICING = 'PRICING',
  GENERAL = 'GENERAL',
}

export class CreateFeedbackDto {
  @IsString({ message: fa.validation.required })
  @IsNotEmpty({ message: fa.validation.required })
  @MaxLength(2000, { message: fa.validation.stringTooLong })
  content: string;

  @IsOptional()
  @IsEnum(FeedbackCategory, { message: fa.validation.required })
  category?: FeedbackCategory;
}
