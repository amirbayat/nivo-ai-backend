import { IsString } from 'class-validator';
import { fa } from '../../../i18n/fa';

export class ConsumeImpersonationDto {
  @IsString({ message: fa.validation.required })
  code: string;
}
