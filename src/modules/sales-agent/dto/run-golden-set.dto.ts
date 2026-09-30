import { IsIn, IsString } from 'class-validator';
import { MODEL_VARIANTS } from '../model-variants';

export class RunGoldenSetDto {
  @IsString()
  storeId!: string;

  @IsIn(Object.keys(MODEL_VARIANTS))
  variant!: string;
}
