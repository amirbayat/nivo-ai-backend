import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { StoreModule } from '../store/store.module';
import { MediaTranscodeModule } from '../../common/services/media-transcode.module';
import { AsrModule } from '../../common/services/asr.module';
import { UsageModule } from '../usage/usage.module';
import { TelegramApiClientModule } from '../telegram/telegram-api-client.module';
import { SellerBotApiClientModule } from '../seller-bot/seller-bot-api-client.module';
import { CommentsModule } from '../comments/comments.module';
import { SmsModule } from '../../sms/sms.module';
import { MarketPricesModule } from '../market-prices/market-prices.module';
import { SalesAgentController } from './sales-agent.controller';
import { SalesAgentService } from './sales-agent.service';
import { ConversationEngineService } from './conversation-engine.service';
import { CreditService } from './credit.service';
import { AbuseGuardService } from './abuse-guard.service';
import { PostPurchaseFollowUpService } from './post-purchase-followup.service';
import { AbandonedCartReminderService } from './abandoned-cart-reminder.service';
import { SalesAgentQaService } from './sales-agent-qa.service';
import { SalesAgentQaController } from './sales-agent-qa.controller';

@Module({
  imports: [
    StoreModule,
    MediaTranscodeModule,
    AsrModule,
    // docs/PRD-seller-credit-billing.md — CreditService از PricingService.calcCost استفاده می‌کند
    UsageModule,
    // docs/PRD-sales-agent-voice.md — مصرف‌کننده/پردازشگر واقعی در queue.module.ts
    BullModule.registerQueue({ name: 'sales-agent-voice' }),
    // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — پوش پیام فروشنده به مشتری‌ای که کانالش تلگرام است
    TelegramApiClientModule,
    // docs/PRD-seller-telegram-management-bot.md — پوش اعلان handoff/رسید حالا روی بات دوم
    // (مدیریت پنل فروشنده) می‌رود، نه بات مشترک مشتری‌محور بالا
    SellerBotApiClientModule,
    // docs/PRD-customer-comments-and-discounts.md — ثبت نظر بعد از تکمیل سفارش + نمایش
    // نظرات تاییدشده در doFaq/showProduct
    CommentsModule,
    // docs/PRD-buyer-phone-otp-registration.md — ارسال کد OTP
    SmsModule,
    // docs/PRD-category-specific-product-pricing-and-attributes.md بخش ۲.۳ — نرخ لحظه‌ای طلا
    // برای resolveProductPrices
    MarketPricesModule,
  ],
  controllers: [SalesAgentController, SalesAgentQaController],
  providers: [
    SalesAgentService,
    ConversationEngineService,
    CreditService,
    AbuseGuardService,
    PostPurchaseFollowUpService,
    AbandonedCartReminderService,
    SalesAgentQaService,
  ],
  // CreditService هم از TelegramModule (handleStart) هم از QueueModule (voice processor) لازم است.
  // PostPurchaseFollowUpService/AbandonedCartReminderService از QueueModule (پردازشگرهای جدید
  // §۵.۳/۵.۴ نقشه‌ی راه) لازم‌اند
  exports: [
    ConversationEngineService,
    CreditService,
    PostPurchaseFollowUpService,
    AbandonedCartReminderService,
  ],
})
export class SalesAgentModule {}
