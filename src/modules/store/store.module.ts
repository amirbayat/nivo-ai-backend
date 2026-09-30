import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { CreditsModule } from '../credits/credits.module';
import { UsageModule } from '../usage/usage.module';
import { TelegramApiClientModule } from '../telegram/telegram-api-client.module';
import { StoreController } from './store.controller';
import { StoreService } from './store.service';
import { StoreKbService } from './store-kb.service';
import { StoreCreditService } from './store-credit.service';
import { StoreBankCardService } from './store-bank-card.service';
import { CardSelectorService } from './card-selector.service';

@Module({
  // docs/PRD-seller-credit-billing.md بخش ۷ — StoreCreditService برای خرید self-serve اعتبار
  // UsageModule (PricingService) — docs/PRD-seller-knowledge-base.md بخش ۲.۳، هزینه‌ی واقعی
  // تکمیل محصول با جستجوی وب. عمداً import مستقیم از sales-agent/credit.service.ts نشد —
  // SalesAgentModule خودش StoreModule را import می‌کند، برعکسش چرخه می‌سازد (همان دلیلی که
  // store-credit.service.ts هم FREE_DAILY_QUOTA را به‌جای import تکرار کرده)
  // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — پوش پیام فروشنده به مشتری‌ای که کانالش تلگرام است
  imports: [
    PaymentsModule,
    CreditsModule,
    UsageModule,
    TelegramApiClientModule,
  ],
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
