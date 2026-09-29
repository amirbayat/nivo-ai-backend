import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { SalesAgentService } from './sales-agent.service';
import { SendMessageDto } from './dto/send-message.dto';
import { StoreService } from '../store/store.service';

// docs/PRD-mvp-launch-plan.md گام ۱ — بدون JwtGuard: مشتری این فروشگاه یک User نیست،
// هویتش فقط sessionToken است که خودِ /chat/start صادر می‌کند (سند بخش ۲.۱: Customer ≠ User).
// عکس محصول (پایین همین کنترلر) هم عمداً همین‌جاست، نه StoreController — چون StoreController
// کلاً پشت JwtGuard است و عکس محصول باید در <img> مرورگر مشتری ناشناس هم لود شود
@Controller('v2')
export class SalesAgentController {
  constructor(
    private readonly salesAgentService: SalesAgentService,
    private readonly storeService: StoreService,
  ) {}

  @Post('stores/:slug/chat/start')
  start(@Param('slug') slug: string, @Body('productId') productId?: string) {
    return this.salesAgentService.startChat(slug, productId);
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
      dto,
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

  // محتوای عمومی ویترین (نه خصوصی مثل رسید) — بدون auth، چون باید در <img> مرورگر مشتری
  // ناشناس هم لود شود؛ مالکیت/تعلق کلید به همین محصول/فروشگاه در سرویس چک می‌شود
  @SkipThrottle()
  @Get('products/:productId/images/:key')
  async getProductImage(
    @Param('productId') productId: string,
    @Param('key') key: string,
    @Res() res: Response,
  ) {
    const { buffer, mimeType } = await this.storeService.getProductImage(
      productId,
      key,
    );
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buffer);
  }
}
