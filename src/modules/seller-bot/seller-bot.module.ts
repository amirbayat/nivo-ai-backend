import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StoreModule } from '../store/store.module';
import { SellerBotController } from './seller-bot.controller';
import { SellerBotService } from './seller-bot.service';
import { SellerBotApiClientModule } from './seller-bot-api-client.module';
import { SellerSupportModule } from '../seller-support/seller-support.module';
import { OrderLifecycleModule } from '../order-lifecycle/order-lifecycle.module';

// docs/PRD-seller-telegram-management-bot.md — AuthService برای OTP (همان مسیر پیامکی پنل
// وب)، StoreService/StoreCreditService برای اکشن‌های مدیریتی؛ نه AuthModule نه StoreModule
// این ماژول را import می‌کنند، پس چرخه‌ای ساخته نمی‌شود. SellerBotApiClientModule جدا است
// چون SalesAgentModule هم مستقیم همان provider را لازم دارد (پوش نوتیفیکیشن handoff/رسید)
@Module({
  imports: [AuthModule, StoreModule, SellerBotApiClientModule, OrderLifecycleModule, SellerSupportModule],
  controllers: [SellerBotController],
  providers: [SellerBotService],
})
export class SellerBotModule {}
