import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../../common/guards/jwt.guard'
import { AdminGuard } from '../../common/guards/admin.guard'
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator'
import { PushNotificationsService } from './push-notifications.service'
import { SendPushNotificationDto } from './dto/send-push-notification.dto'

@Controller('admin/push-notifications')
@UseGuards(JwtGuard, AdminGuard)
export class PushNotificationsController {
  constructor(private readonly pushNotifications: PushNotificationsService) {}

  @Post()
  @HttpCode(200)
  send(@CurrentUser() user: JwtPayload, @Body() dto: SendPushNotificationDto) {
    return this.pushNotifications.send(user.sub, dto)
  }

  @Get()
  list(@Query('page') page?: string) {
    return this.pushNotifications.list(page ? Number(page) : 1)
  }
}
