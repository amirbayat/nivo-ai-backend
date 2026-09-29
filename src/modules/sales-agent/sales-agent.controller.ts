import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SalesAgentService } from './sales-agent.service';
import { SendMessageDto } from './dto/send-message.dto';

// docs/PRD-mvp-launch-plan.md گام ۱ — بدون JwtGuard: مشتری این فروشگاه یک User نیست،
// هویتش فقط sessionToken است که خودِ /chat/start صادر می‌کند (سند بخش ۲.۱: Customer ≠ User)
@Controller('v2')
export class SalesAgentController {
  constructor(private readonly salesAgentService: SalesAgentService) {}

  @Post('stores/:slug/chat/start')
  start(@Param('slug') slug: string) {
    return this.salesAgentService.startChat(slug);
  }

  @Post('chat/:conversationId/messages')
  sendMessage(
    @Param('conversationId') conversationId: string,
    @Headers('x-session-token') sessionToken: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.salesAgentService.sendMessage(
      conversationId,
      sessionToken,
      dto.message,
    );
  }

  @Post('chat/:conversationId/receipt')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  submitReceipt(
    @Param('conversationId') conversationId: string,
    @Headers('x-session-token') sessionToken: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.salesAgentService.submitReceipt(
      conversationId,
      sessionToken,
      file,
    );
  }

  @Get('chat/:conversationId')
  getConversation(
    @Param('conversationId') conversationId: string,
    @Headers('x-session-token') sessionToken: string,
  ) {
    return this.salesAgentService.getConversation(conversationId, sessionToken);
  }
}
