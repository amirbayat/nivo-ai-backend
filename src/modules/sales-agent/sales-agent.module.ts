import { Module } from '@nestjs/common';
import { SalesAgentController } from './sales-agent.controller';
import { SalesAgentService } from './sales-agent.service';
import { ConversationEngineService } from './conversation-engine.service';

@Module({
  controllers: [SalesAgentController],
  providers: [SalesAgentService, ConversationEngineService],
})
export class SalesAgentModule {}
