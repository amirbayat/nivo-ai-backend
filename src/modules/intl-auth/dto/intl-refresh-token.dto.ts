import { IsString } from 'class-validator';
import { en } from '../../../i18n/en';

export class IntlRefreshTokenDto {
  @IsString({ message: en.validation.required })
  refreshToken: string;
}
