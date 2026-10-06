import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AuthService } from './auth.service';
import { CreateImpersonationDto } from './dto/create-impersonation.dto';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';

// docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md — ورود ادمین به‌جای فروشنده
// (برای ویرایش دستی دیتای فروشگاه‌های دمو از همان پنل واقعی) یا خریدار (برای دیباگ)
@Controller('admin/impersonate')
@UseGuards(JwtGuard, AdminGuard)
export class AdminImpersonateController {
  constructor(private readonly authService: AuthService) {}

  @Post()
  create(
    @CurrentUser() admin: JwtPayload,
    @Body() dto: CreateImpersonationDto,
  ) {
    return this.authService
      .createImpersonationCode(dto, admin.sub)
      .then((code) => ({ code }));
  }
}
