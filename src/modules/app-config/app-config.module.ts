import { Module } from '@nestjs/common';
import { AppConfigController } from './app-config.controller';
import { ChatConfigModule } from '../chat-config/chat-config.module';

@Module({
  imports: [ChatConfigModule],
  controllers: [AppConfigController],
})
export class AppConfigModule {}
