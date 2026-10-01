import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { SalesAgentQaService } from './sales-agent-qa.service';
import { RunGoldenSetDto } from './dto/run-golden-set.dto';
import { RunIntentGoldenSetDto } from './dto/run-intent-golden-set.dto';

// docs/PRD-product-strategy-and-roadmap.md بخش ۵.۵ — ابزار QA داخلی تیم، نه فروشنده؛ پشت
// همان JwtGuard+AdminGuard بقیه‌ی admin.controller.ts، فقط در یک کنترلر جدا تا آن فایل
// (از قبل ۲۰۰+ خط) بزرگ‌تر نشود
@Controller('admin/sales-agent-qa')
@UseGuards(JwtGuard, AdminGuard)
export class SalesAgentQaController {
  constructor(private readonly qaService: SalesAgentQaService) {}

  @Get('stores')
  listStores() {
    return this.qaService.listStores();
  }

  @Post('run')
  run(@Body() dto: RunGoldenSetDto) {
    return this.qaService.runGoldenSet(dto.storeId, dto.variant);
  }

  // docs/PRD-buyer-purchase-intent-taxonomy.md بخش ۵.۴ — بدون storeId، چون طبقه‌بندی intent
  // به یک فروشگاه/محصول واقعی وابسته نیست
  @Post('run-intent')
  runIntent(@Body() dto: RunIntentGoldenSetDto) {
    return this.qaService.runIntentGoldenSet(dto.variant);
  }
}
