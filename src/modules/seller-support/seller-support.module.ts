import { Module } from '@nestjs/common';
import { StoreModule } from '../store/store.module';
import { UsageModule } from '../usage/usage.module';
import { TicketsModule } from '../tickets/tickets.module';
import { SmsModule } from '../../sms/sms.module';
import { SellerBotApiClientModule } from '../seller-bot/seller-bot-api-client.module';
import { SellerSupportAgentService } from './seller-support-agent.service';
import { SellerSupportTicketService } from './seller-support-ticket.service';

// docs/PRD-seller-bot-support-agent.md — SellerBotModule این ماژول را import می‌کند (نه برعکس)؛
// رله‌ی جواب ادمین با listener روی TicketsService انجام می‌شود تا چرخه‌ای ساخته نشود
@Module({
  imports: [StoreModule, UsageModule, TicketsModule, SmsModule, SellerBotApiClientModule],
  providers: [SellerSupportAgentService, SellerSupportTicketService],
  exports: [SellerSupportAgentService, SellerSupportTicketService],
})
export class SellerSupportModule {}
