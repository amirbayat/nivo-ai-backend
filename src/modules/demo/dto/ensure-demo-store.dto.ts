import { IsString } from 'class-validator';
import { fa } from '../../../i18n/fa';

export class EnsureDemoStoreDto {
  @IsString({ message: fa.validation.required })
  category: string;
}
