import { Module } from '@nestjs/common';
import { ChatConfigService } from './chat-config.service';
import { ChatConfigAdminController } from './chat-config-admin.controller';

@Module({
  controllers: [ChatConfigAdminController],
  providers: [ChatConfigService],
  exports: [ChatConfigService],
})
export class ChatConfigModule {}
