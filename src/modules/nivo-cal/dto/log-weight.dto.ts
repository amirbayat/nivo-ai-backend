import { IsNumber, Max, Min } from 'class-validator';
import { fa } from '../../../i18n/fa';

export class LogWeightDto {
  @IsNumber({}, { message: fa.validation.mustBeNumber })
  @Min(30)
  @Max(300)
  weightKg: number;
}
