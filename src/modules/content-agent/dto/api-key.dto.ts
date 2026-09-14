import { IsBoolean, IsString, MinLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

export class CreateApiKeyDto {
  @IsString({ message: fa.validation.required })
  @MinLength(1, { message: fa.validation.required })
  label!: string;
}

export class UpdateApiKeyDto {
  @IsBoolean({ message: fa.validation.mustBeBoolean })
  isActive!: boolean;
}
