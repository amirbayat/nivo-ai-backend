import { IsOptional, IsString, MaxLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

export class CreateConversationDto {
  @IsString({ message: fa.validation.required })
  @MaxLength(50, { message: fa.validation.stringTooLong })
  model: string;

  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(200, { message: fa.validation.stringTooLong })
  title?: string;

  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(2000, { message: fa.validation.stringTooLong })
  systemPrompt?: string;

  @IsOptional()
  @IsString({ message: fa.validation.required })
  projectId?: string;
}
