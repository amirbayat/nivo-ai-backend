import { Module } from '@nestjs/common';
import { TelegramApiClientService } from './telegram-api-client.service';

@Module({
  providers: [TelegramApiClientService],
  exports: [TelegramApiClientService],
})
export class TelegramApiClientModule {}
