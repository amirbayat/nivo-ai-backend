import { IsNotEmpty, IsString } from 'class-validator'
import { fa } from '../../../i18n/fa'

export class RegisterDeviceTokenDto {
  @IsString({ message: fa.validation.required })
  @IsNotEmpty({ message: fa.validation.required })
  deviceUuid: string

  @IsString({ message: fa.validation.required })
  @IsNotEmpty({ message: fa.validation.required })
  fcmToken: string
}
