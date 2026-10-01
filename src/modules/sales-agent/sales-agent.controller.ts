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

  // docs/PRD-conversation-history.md — دکمه‌ی «گفتگوی جدید»؛ همان sessionToken می‌ماند، فقط
  // یک SalesConversation تازه برای همان Customer ساخته می‌شود
  @Post('chat/:conversationId/restart')
  restart(
    @Param('conversationId') conversationId: string,
    @Headers('x-session-token') sessionToken: string,
  ) {
    return this.salesAgentService.restartConversation(
      conversationId,
      sessionToken,
    );
  }

  // docs/PRD-conversation-history.md بخش ۳ — تاریخچه‌ی همه‌ی مکالمات (فعال+آرشیوشده) همین خریدار
  @Get('stores/:slug/customer-history')
  getCustomerHistory(
    @Param('slug') slug: string,
    @Headers('x-session-token') sessionToken: string,
  ) {
    return this.salesAgentService.getCustomerHistory(slug, sessionToken);
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

  // docs/PRD-sales-agent-voice.md بخش ۲.۲ — وویس ورودی مشتری از وب (ضبط با MediaRecorder)
  @Post('chat/:conversationId/voice-message')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  submitVoiceMessage(
    @Param('conversationId') conversationId: string,
    @Headers('x-session-token') sessionToken: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.salesAgentService.submitVoiceMessage(
      conversationId,
      sessionToken,
      file,
    );
  }

  // پول کوتاه بخش ۱.۲ — کلاینت وب فقط وقتی voiceEventId در پاسخ آمده، این را چند بار صدا می‌زند
  @Get('chat/:conversationId/voice-status/:eventId')
  getVoiceStatus(
    @Param('conversationId') conversationId: string,
    @Headers('x-session-token') sessionToken: string,
    @Param('eventId') eventId: string,
  ) {
    return this.salesAgentService.getVoiceStatus(
      conversationId,
      sessionToken,
      eventId,
    );
  }

  // سرو فایل صوتی — عمومی/کلید غیرقابل‌حدس (بخش ۱.۵)، نه session-token، چون سرورهای تلگرام
  // هم باید بتوانند مستقیم آن را fetch کنند (sendAudio با URL)
  @SkipThrottle()
  @Get('chat/:conversationId/voice/:key')
  async getVoiceAudio(
    @Param('conversationId') conversationId: string,
    @Param('key') key: string,
    @Res() res: Response,
  ) {
    const buffer = await this.salesAgentService.getVoiceAudio(
      conversationId,
      key,
    );
    // فایل واقعاً WAV است (sales-agent-voice.processor.ts downloadAndStore) — قبلاً اینجا
    // audio/mpeg فرستاده می‌شد و مرورگر دیکود می‌کرد fail می‌شد (پخش خاموش، بدون خطای قابل‌دیدن)
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buffer);
  }

  // docs/PRD-sales-agent-voice.md بخش ۶.۵ — onPlay تگ audio وب؛ نیاز به session-token دارد
  // (برخلاف GET بالا که عمومی است) چون این واقعاً یک سیگنال معنادار آماری می‌سازد، نه صرف سرو فایل
  @Post('chat/:conversationId/voice/:key/heard')
  markVoiceHeard(
    @Param('conversationId') conversationId: string,
    @Headers('x-session-token') sessionToken: string,
    @Param('key') key: string,
  ) {
    return this.salesAgentService.markVoiceHeard(
      conversationId,
      sessionToken,
      key,
    );
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
