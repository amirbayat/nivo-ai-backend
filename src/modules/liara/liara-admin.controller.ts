import { Controller, Get, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../../common/guards/jwt.guard'
import { AdminGuard } from '../../common/guards/admin.guard'
import { LiaraKeyProvisioningService } from './liara-key-provisioning.service'

// docs/PRD-liara-usage-reconciliation.md — رصد سلامتِ ساخت کلید اختصاصی هر کاربر؛ کاربرانی که
// الان به‌خاطر خطا (مثلاً JWT مدیریتی منقضی) روی کلید مشترک fallback هستند
@Controller('admin/liara')
@UseGuards(JwtGuard, AdminGuard)
export class LiaraAdminController {
  constructor(private readonly provisioning: LiaraKeyProvisioningService) {}

  @Get('provisioning-issues')
  listProvisioningIssues() {
    return this.provisioning.listOpenIssues()
  }
}
