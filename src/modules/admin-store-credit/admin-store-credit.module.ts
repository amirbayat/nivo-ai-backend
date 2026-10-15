import { Module } from '@nestjs/common';
import { StoreCreditEngineModule } from '../store-credit-engine/store-credit-engine.module';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { AdminStoreCreditController } from './admin-store-credit.controller';
import { AdminStoreCreditService } from './admin-store-credit.service';

@Module({
  imports: [StoreCreditEngineModule, AdminAuditModule],
  controllers: [AdminStoreCreditController],
  providers: [AdminStoreCreditService],
})
export class AdminStoreCreditModule {}
