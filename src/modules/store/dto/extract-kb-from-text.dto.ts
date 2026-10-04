import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

export class ExtractKbFromTextDto {
  @IsString()
  @IsNotEmpty({ message: fa.storeKb.textRequired })
  @MaxLength(20000, { message: fa.validation.stringTooLong })
  rawText: string;
}
