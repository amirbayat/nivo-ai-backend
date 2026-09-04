import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

export class CreateVideoProjectDto {
  @IsString()
  @MinLength(3, { message: fa.validation.required })
  @MaxLength(2000, { message: fa.validation.stringTooLong })
  initialPrompt: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  visualStyle?: string;
}
