import { IsOptional, IsString, MaxLength } from 'class-validator';
import { fa } from '../../../i18n/fa';

export class InitAnonSessionDto {
  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(200, { message: fa.validation.stringTooLong })
  utmSource?: string;

  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(200, { message: fa.validation.stringTooLong })
  utmMedium?: string;

  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(200, { message: fa.validation.stringTooLong })
  utmCampaign?: string;

  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(200, { message: fa.validation.stringTooLong })
  utmContent?: string;

  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(200, { message: fa.validation.stringTooLong })
  utmTerm?: string;

  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(500, { message: fa.validation.stringTooLong })
  referrer?: string;

  @IsOptional()
  @IsString({ message: fa.validation.required })
  @MaxLength(200, { message: fa.validation.stringTooLong })
  landingPath?: string;
}
