import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { fa } from '../../../i18n/fa';

export class ListConversationsDto {
  @IsOptional()
  @IsString({ message: fa.validation.required })
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: fa.validation.mustBeNumber })
  @Min(1, { message: fa.validation.numberPositive })
  @Max(50, { message: fa.validation.stringTooLong })
  limit?: number = 20;

  @IsOptional()
  @IsString({ message: fa.validation.required })
  projectId?: string;
}
