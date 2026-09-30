import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { CreditsModule } from '../credits/credits.module';
import { StoreController } from './store.controller';
import { StoreService } from './store.service';
import { StoreKbService } from './store-kb.service';
import { StoreCreditService } from './store-credit.service';

@Module({
  // docs/PRD-seller-credit-billing.md بخش ۷ — StoreCreditService برای خرید self-serve اعتبار
  imports: [PaymentsModule, CreditsModule],
  controllers: [StoreController],
  providers: [StoreService, StoreKbService, StoreCreditService],
  exports: [StoreService, StoreKbService],
})
export class StoreModule {}
