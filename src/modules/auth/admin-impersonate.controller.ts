import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AuthService } from './auth.service';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
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
  constructor(
    private readonly authService: AuthService,
    private readonly audit: AdminAuditService,
  ) {}

  @Post()
  create(
    @CurrentUser() admin: JwtPayload,
    @Body() dto: CreateImpersonationDto,
  ) {
    return this.authService
      .createImpersonationCode(dto, admin.sub)
      .then(async (code) => {
        // R1.1 — هر impersonation ثبت می‌شود (شکست لاگ مانع ورود ادمین نمی‌شود)
        await this.audit.recordSafely({
          adminId: admin.sub,
          action: 'IMPERSONATE',
          targetType: 'USER',
          targetId: dto.userId ?? dto.phone ?? 'unknown',
          reason: dto.reason?.trim() || 'impersonation',
        });
        return { code };
      });
  }
}
