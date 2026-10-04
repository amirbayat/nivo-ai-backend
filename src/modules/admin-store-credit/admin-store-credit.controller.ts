import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { CreditUsageKind } from '@prisma/client';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { parseDateRange } from '../usage-analytics/usage-analytics.service';
import { AdminStoreCreditService } from './admin-store-credit.service';

// docs/PRD-admin-seller-credit-overview.md — ماژول جدا از AdminModule غول‌پیکر موجود (مثل
// admin-creative)، تا ریسک تغییر روی کد پرکاربرد فعلی صفر باشد.
@Controller('admin/stores')
@UseGuards(JwtGuard, AdminGuard)
export class AdminStoreCreditController {
  constructor(private readonly service: AdminStoreCreditService) {}

  @Get()
  getStores(
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
  ) {
    return this.service.getStores({
      search,
      range: parseDateRange(from, to),
      page: page ? parseInt(page, 10) : undefined,
    });
  }

  @Get(':id/credit-usage')
  getStoreCreditUsage(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('kind') kind?: CreditUsageKind,
    @Query('page') page?: string,
  ) {
    return this.service.getStoreCreditUsage({
      storeId: id,
      range: parseDateRange(from, to),
      kind,
      page: page ? parseInt(page, 10) : undefined,
    });
  }
}
