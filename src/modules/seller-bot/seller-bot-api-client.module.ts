import { Module } from '@nestjs/common';
import { SellerBotApiClientService } from './seller-bot-api-client.service';

// عیناً الگوی TelegramApiClientModule — ماژول مستقل تا ConversationEngineService
// (SalesAgentModule) بتواند مستقیم importش کند، بدون وابستگی به SellerBotModule
// (که AuthModule/StoreModule را import می‌کند و چرخه می‌سازد)
@Module({
  providers: [SellerBotApiClientService],
  exports: [SellerBotApiClientService],
})
export class SellerBotApiClientModule {}
