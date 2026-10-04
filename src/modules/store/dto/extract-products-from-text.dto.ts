import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

export class ExtractProductsFromTextDto {
  @IsString()
  @IsNotEmpty({ message: fa.store.bulkImportTextRequired })
  @MaxLength(8000, { message: fa.validation.stringTooLong })
  rawText: string;
}
