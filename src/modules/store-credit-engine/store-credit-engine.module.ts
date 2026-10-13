import { Module } from '@nestjs/common';
import { StoreCreditDeductionService } from './store-credit-deduction.service';

// فاز ۱ — ماژول مستقل (بدون وابستگی به Payments/Credits/Store) تا همه‌ی مصرف‌کننده‌ها
// (sales-agent، store، guide-assistant، payments) بدون import چرخه‌ای از آن استفاده کنند.
// PrismaModule و RedisModule سراسری‌اند.
@Module({
  providers: [StoreCreditDeductionService],
  exports: [StoreCreditDeductionService],
})
export class StoreCreditEngineModule {}
