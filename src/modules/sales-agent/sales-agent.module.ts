import { Module } from '@nestjs/common';
import { StoreModule } from '../store/store.module';
import { SalesAgentController } from './sales-agent.controller';
import { SalesAgentService } from './sales-agent.service';
import { ConversationEngineService } from './conversation-engine.service';

@Module({
  imports: [StoreModule],
  controllers: [SalesAgentController],
  providers: [SalesAgentService, ConversationEngineService],
})
export class SalesAgentModule {}
