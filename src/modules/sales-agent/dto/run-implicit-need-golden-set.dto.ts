import { IsIn } from 'class-validator';
import { MODEL_VARIANTS } from '../model-variants';

export class RunImplicitNeedGoldenSetDto {
  @IsIn(Object.keys(MODEL_VARIANTS))
  variant!: string;
}
