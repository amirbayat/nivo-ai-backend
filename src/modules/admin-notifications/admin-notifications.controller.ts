import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../../common/guards/jwt.guard'
import { AdminGuard } from '../../common/guards/admin.guard'
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator'
import { AdminNotificationsService } from './admin-notifications.service'
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto'

@Controller('admin/notifications')
@UseGuards(JwtGuard, AdminGuard)
export class AdminNotificationsController {
  constructor(private readonly notifications: AdminNotificationsService) {}

  @Get()
  list(@Query('page') page?: string) {
    return this.notifications.list(page ? Number(page) : 1)
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: JwtPayload) {
    return this.notifications.unreadCount(user.sub)
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.notifications.markRead(id, user.sub)
  }

  @Post('read-all')
  @HttpCode(200)
  markAllRead(@CurrentUser() user: JwtPayload) {
    return this.notifications.markAllRead(user.sub)
  }

  // اپ موبایل ادمین (docs/PRD-admin-notifications-and-mobile.md بخش ۶) بعد از دریافت توکن FCM
  // این را صدا می‌زند — همان الگوی android-app/.../NivoFirebaseMessagingService.kt:onNewToken
  @Post('device-token')
  @HttpCode(200)
  registerDeviceToken(@CurrentUser() user: JwtPayload, @Body() dto: RegisterDeviceTokenDto) {
    return this.notifications.registerDeviceToken(user.sub, dto.token)
  }
}
