import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
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

  @Get('summary')
  getSummary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.getSummary({ range: parseDateRange(from, to) });
  }

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

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۶ — فقط ادمین می‌تواند این
  // را روشن/خاموش کند؛ عمداً اینجا (کنار AdminGuard موجود)، نه در store.controller.ts فروشنده
  @Patch(':id/lead-capture-only')
  setLeadCaptureOnly(
    @Param('id') id: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.service.setLeadCaptureOnly(id, body.enabled);
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
