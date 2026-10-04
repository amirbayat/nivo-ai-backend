import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StoreModule } from '../store/store.module';
import { SellerBotController } from './seller-bot.controller';
import { SellerBotService } from './seller-bot.service';
import { SellerBotApiClientService } from './seller-bot-api-client.service';

// docs/PRD-seller-telegram-management-bot.md — AuthService برای OTP (همان مسیر پیامکی پنل
// وب)، StoreService/StoreCreditService برای اکشن‌های مدیریتی؛ نه AuthModule نه StoreModule
// این ماژول را import می‌کنند، پس چرخه‌ای ساخته نمی‌شود
@Module({
  imports: [AuthModule, StoreModule],
  controllers: [SellerBotController],
  providers: [SellerBotService, SellerBotApiClientService],
})
export class SellerBotModule {}
