import { Global, Module } from '@nestjs/common';
import { AiCostAdminController } from './ai-cost.admin.controller';
import { AiCostReportService } from './ai-cost-report.service';
import { LedgerService } from './ledger.service';

@Global()
@Module({ controllers: [AiCostAdminController], providers: [LedgerService, AiCostReportService], exports: [LedgerService] })
export class AiCostEngineModule {}
