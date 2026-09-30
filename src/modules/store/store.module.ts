import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { CreditsModule } from '../credits/credits.module';
import { StoreController } from './store.controller';
import { StoreService } from './store.service';
import { StoreKbService } from './store-kb.service';
import { StoreCreditService } from './store-credit.service';
import { StoreBankCardService } from './store-bank-card.service';
import { CardSelectorService } from './card-selector.service';

@Module({
  // docs/PRD-seller-credit-billing.md بخش ۷ — StoreCreditService برای خرید self-serve اعتبار
  imports: [PaymentsModule, CreditsModule],
  controllers: [StoreController],
  providers: [
    StoreService,
    StoreKbService,
    StoreCreditService,
    StoreBankCardService,
    CardSelectorService,
  ],
  // CardSelectorService هم از SalesAgentModule (doCreateOrder) لازم است —
  // docs/PRD-seller-multi-bank-card-rotation.md بخش ۲
  exports: [StoreService, StoreKbService, CardSelectorService],
})
export class StoreModule {}
