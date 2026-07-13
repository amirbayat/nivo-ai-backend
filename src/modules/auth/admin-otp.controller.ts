import { Controller, ForbiddenException, Get, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../../common/guards/jwt.guard'
import { AdminGuard } from '../../common/guards/admin.guard'
import { AuthService } from './auth.service'
import { fa } from '../../i18n/fa'

@Controller('admin/otp')
@UseGuards(JwtGuard, AdminGuard)
export class AdminOtpController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  list() {
    if (!this.authService.isOtpViewerEnabled()) throw new ForbiddenException(fa.errors.forbidden)
    return this.authService.listActiveOtps()
  }
}
