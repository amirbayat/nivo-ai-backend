import { Global, Module } from '@nestjs/common';
import { AiCostAdminController } from './ai-cost.admin.controller';
import { LedgerService } from './ledger.service';

@Global()
@Module({ controllers: [AiCostAdminController], providers: [LedgerService], exports: [LedgerService] })
export class AiCostEngineModule {}
