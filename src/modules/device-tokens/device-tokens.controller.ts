import { Body, Controller, HttpCode, Post } from '@nestjs/common'
import { DeviceTokensService } from './device-tokens.service'
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto'

// بدون Guard عمداً — کاربر ناشناس (هنوز لاگین نکرده) هم باید بتواند توکن ثبت کند
// (docs/PRD-user-push-notifications-and-mobile-app-flows.md بخش ۴)
@Controller('device-tokens')
export class DeviceTokensController {
  constructor(private readonly deviceTokens: DeviceTokensService) {}

  @Post('register')
  @HttpCode(200)
  register(@Body() dto: RegisterDeviceTokenDto) {
    return this.deviceTokens.register(dto.deviceUuid, dto.fcmToken)
  }
}
