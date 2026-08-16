import { IsOptional, IsString, MaxLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

export class UpdateUserDto {
  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(100, { message: fa.validation.stringTooLong })
  name?: string;
}
