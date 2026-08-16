import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { fa } from '../../../i18n/fa';

export class ReviewPromptRequestDto {
  @IsOptional()
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  isReviewed?: boolean;

  @IsOptional()
  @IsString()
  adminNote?: string;
}
