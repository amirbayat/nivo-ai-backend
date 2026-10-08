import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { CreditsModule } from '../credits/credits.module';
import { UsageModule } from '../usage/usage.module';
import { TelegramApiClientModule } from '../telegram/telegram-api-client.module';
import { CommentsModule } from '../comments/comments.module';
import { AsrModule } from '../../common/services/asr.module';
import { MediaTranscodeModule } from '../../common/services/media-transcode.module';
import { MarketPricesModule } from '../market-prices/market-prices.module';
import { StoreController } from './store.controller';
import { DemoProductsAdminController } from './demo-products-admin.controller';
import { StoreService } from './store.service';
import { StoreKbService } from './store-kb.service';
import { StoreCreditService } from './store-credit.service';
import { StoreBankCardService } from './store-bank-card.service';
import { StoreDiscountCodeService } from './store-discount-code.service';
import { StoreShippingRuleService } from './store-shipping-rule.service';
import { StoreAdPlacementService } from './store-ad-placement.service';
import { CardSelectorService } from './card-selector.service';
import { ProductEnrichmentService } from './product-enrichment.service';
import { ProductEnrichmentReminderService } from './product-enrichment-reminder.service';
import { ContentChangeLogService } from './content-change-log.service';

@Module({
  // docs/PRD-seller-credit-billing.md بخش ۷ — StoreCreditService برای خرید self-serve اعتبار
  // UsageModule (PricingService) — docs/PRD-seller-knowledge-base.md بخش ۲.۳، هزینه‌ی واقعی
  // تکمیل محصول با جستجوی وب. عمداً import مستقیم از sales-agent/credit.service.ts نشد —
  // SalesAgentModule خودش StoreModule را import می‌کند، برعکسش چرخه می‌سازد (به همین دلیل
  // store-credit.service.ts عدد سهمیه‌ی رایگان را مستقیم از sales-agent-global-config.util.ts
  // می‌خواند، نه از CreditService)
  // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — پوش پیام فروشنده به مشتری‌ای که کانالش تلگرام است
  imports: [
    PaymentsModule,
    CreditsModule,
    UsageModule,
    TelegramApiClientModule,
    // docs/PRD-customer-comments-and-discounts.md بخش ۶ — StoreKbService از نظرات تاییدشده
    // به‌عنوان منبع کمکی تکمیل توضیحات استفاده می‌کند
    CommentsModule,
    // فیدبک کاربر ۱۴۰۵/۰۷/۰۱ — میکروفون/تبدیل صدا به متن فروشنده روی فرم محصول
    AsrModule,
    MediaTranscodeModule,
    MarketPricesModule,
  ],
  controllers: [StoreController, DemoProductsAdminController],
  providers: [
    StoreService,
    StoreKbService,
    StoreCreditService,
    StoreBankCardService,
    StoreDiscountCodeService,
    StoreShippingRuleService,
    StoreAdPlacementService,
    CardSelectorService,
    ProductEnrichmentService,
    ProductEnrichmentReminderService,
    ContentChangeLogService,
  ],
  // docs/PRD-seller-guide-assistant-modal.md بخش ۱.۳ — ContentChangeLogService هم از
  // AdminModule لازم است (endpoint مشاهده‌ی لاگ تغییرات محتوا)
  // CardSelectorService هم از SalesAgentModule (doCreateOrder) لازم است —
  // docs/PRD-seller-multi-bank-card-rotation.md بخش ۲
  // ProductEnrichmentService هم از AdminModule لازم است — docs/PRD-admin-product-enrichment-review.md
  // ProductEnrichmentReminderService هم از QueueModule لازم است (cron هفتگی یادآوری)
  // StoreCreditService هم از SellerBotModule لازم است (دستور /credit) —
  // docs/PRD-seller-telegram-management-bot.md
  exports: [
    StoreService,
    StoreKbService,
    StoreCreditService,
    CardSelectorService,
    ProductEnrichmentService,
    ProductEnrichmentReminderService,
    ContentChangeLogService,
  ],
})
export class StoreModule {}
