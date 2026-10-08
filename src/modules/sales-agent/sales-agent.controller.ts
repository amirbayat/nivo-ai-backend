import {
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { SalesAgentService } from './sales-agent.service';
import { SendMessageDto } from './dto/send-message.dto';
import { SetResponseStrategyDto } from './dto/set-response-strategy.dto';
import { SendBuyerOtpDto, VerifyBuyerOtpDto } from './dto/register-buyer.dto';
import { SubmitCommentDto } from './dto/submit-comment.dto';
import { StoreService } from '../store/store.service';
import { CommentsService } from '../comments/comments.service';
import { StorageService } from '../../storage/storage.service';
import { mimeTypeForExt } from '../../common/validators/chat-image.validator';
import { fa } from '../../i18n/fa';

// docs/PRD-mvp-launch-plan.md گام ۱ — بدون JwtGuard: مشتری این فروشگاه یک User نیست،
// هویتش فقط sessionToken است که خودِ /chat/start صادر می‌کند (سند بخش ۲.۱: Customer ≠ User).
// عکس محصول (پایین همین کنترلر) هم عمداً همین‌جاست، نه StoreController — چون StoreController
// کلاً پشت JwtGuard است و عکس محصول باید در <img> مرورگر مشتری ناشناس هم لود شود
@Controller('v2')
export class SalesAgentController {
  constructor(
    private readonly salesAgentService: SalesAgentService,
    private readonly storeService: StoreService,
    private readonly comments: CommentsService,
    private readonly storage: StorageService,
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

  // docs/PRD-panels-and-buyer-ux-design.md بخش ۳.۵ — حالت «فروشگاه»، گرید کامل محصولات؛
  // بدون auth (عیناً الگوی chat/start بالا)، صفحه‌بندی‌شده، فقط فیلدهای نمایشی ایمن
  // فیدبک کاربر ۱۴۰۵/۰۷/۱۲ — این مسیر عمداً «public-products» است نه «products»: قبلاً دقیقاً
  // همین شکل (stores/:slug/products) با StoreController::@Get(':id/products') (مسیر پنل
  // فروشنده، احراز‌هویت‌شده) collision داشت. Nest/Express مسیرها را به ترتیب رجیستر امتحان
  // می‌کنند و اولین match برنده است — چون این کنترلر زودتر رجیستر می‌شد، هر درخواست GET به
  // .../stores/:id/products (حتی با JWT معتبر فروشنده) همیشه همین هندلر عمومی را می‌گرفت و
  // چون id واقعی یک slug نیست، «فروشگاه یافت نشد» برمی‌گرداند — باگ: لیست محصولات پنل فروشنده
  // همیشه ۴۰۴ می‌داد. اسم این مسیر را عوض کردیم تا دیگر هیچ‌وقت با چیزی زیر StoreController
  // تصادفی هم‌شکل نشود (به‌جای تکیه به ترتیب رجیستر ماژول‌ها که شکننده است).
  @Get('stores/:slug/public-products')
  listStoreProducts(
    @Param('slug') slug: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.storeService.listPublicProducts(slug, {
      q,
      page: Math.max(1, parseInt(page ?? '1', 10) || 1),
      pageSize: Math.min(60, Math.max(1, parseInt(pageSize ?? '24', 10) || 24)),
    });
  }

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۴.۲ — «مشاهده نظرات
  // خریداران قبلی»، عمومی/بدون session-token (عیناً الگوی public-products بالا) چون محتوای
  // تاییدشده‌ی نمایشی است، نه چیز خصوصی؛ برخلاف getApprovedForProduct داخلی (فقط مصرف AI)
  @Get('stores/:slug/products/:productId/reviews')
  getProductReviews(
    @Param('slug') slug: string,
    @Param('productId') productId: string,
  ) {
    return this.storeService.getApprovedProductReviews(slug, productId);
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

  // عکسی که خریدار در حالت «صحبت با فروشنده» (isMutedForHuman) می‌فرستد — جدا از رسید
  @Post('chat/:conversationId/image')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  submitImageMessage(
    @Param('conversationId') conversationId: string,
    @Headers('x-session-token') sessionToken: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.salesAgentService.submitImageMessage(
      conversationId,
      sessionToken,
      file,
    );
  }

  // docs/PRD-order-status-chat-tool-and-fulfillment-delay-reviews.md بخش ۳.۱ — ویدیویی که
  // خریدار در حالت «صحبت با فروشنده» یا در لحظه‌ی awaitingReview می‌فرستد؛ هم‌الگوی image بالا
  @Post('chat/:conversationId/video')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  submitVideoMessage(
    @Param('conversationId') conversationId: string,
    @Headers('x-session-token') sessionToken: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.salesAgentService.submitVideoMessage(
      conversationId,
      sessionToken,
      file,
    );
  }

  // docs/PRD-buyer-orders-page-and-direct-order.md بخش ۲.۲ — صفحه‌ی مستقل «سفارش‌های من»،
  // خارج از AI/engine
  @Get('chat/:conversationId/orders')
  listMyOrders(
    @Param('conversationId') conversationId: string,
    @Headers('x-session-token') sessionToken: string,
  ) {
    return this.salesAgentService.listMyOrders(conversationId, sessionToken);
  }

  // docs/PRD-buyer-orders-page-and-direct-order.md بخش ۲.۳ — ثبت نظر مستقیم از روی محصول/سفارش
  @Post('chat/:conversationId/comments')
  submitComment(
    @Param('conversationId') conversationId: string,
    @Headers('x-session-token') sessionToken: string,
    @Body() dto: SubmitCommentDto,
  ) {
    return this.salesAgentService.submitDirectComment(
      conversationId,
      sessionToken,
      dto,
    );
  }

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۴.۲ — آپلود رسانه‌ی نظر
  // قبل از ثبت؛ کلید برگشتی در بدنه‌ی POST .../comments بالا (imageKey/videoKey/audioKey) پاس
  // داده می‌شود. سقف ۲۰ مگابایت در سطح interceptor؛ سقف دقیق‌تر هر نوع در سرویس
  @Post('chat/:conversationId/comment-media')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  submitCommentMedia(
    @Param('conversationId') conversationId: string,
    @Headers('x-session-token') sessionToken: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.salesAgentService.submitCommentMedia(
      conversationId,
      sessionToken,
      file,
    );
  }

  // docs/PRD-buyer-phone-otp-registration.md — ثبت‌نام اختیاری خریدار با شماره+OTP
  @Post('chat/:conversationId/register/send-otp')
  sendBuyerOtp(
    @Param('conversationId') conversationId: string,
    @Headers('x-session-token') sessionToken: string,
    @Body() dto: SendBuyerOtpDto,
  ) {
    return this.salesAgentService.sendBuyerOtp(
      conversationId,
      sessionToken,
      dto.phone,
    );
  }

  @Post('chat/:conversationId/register/verify-otp')
  verifyBuyerOtp(
    @Param('conversationId') conversationId: string,
    @Headers('x-session-token') sessionToken: string,
    @Body() dto: VerifyBuyerOtpDto,
  ) {
    return this.salesAgentService.verifyBuyerOtp(
      conversationId,
      sessionToken,
      dto.phone,
      dto.code,
      dto.fullName,
    );
  }

  // سرو همان عکس — عمومی/کلید غیرقابل‌حدس، عیناً الگوی chat/:conversationId/voice/:key پایین
  @SkipThrottle()
  @Get('chat/:conversationId/image/:key')
  async getChatImage(
    @Param('conversationId') conversationId: string,
    @Param('key') key: string,
    @Res() res: Response,
  ) {
    const { buffer, mimeType } = await this.salesAgentService.getChatImage(
      conversationId,
      key,
    );
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buffer);
  }

  // docs/PRD-panels-and-buyer-ux-design.md بخش ۳.۶ (فاز ۴.۸، مورد ۳) — «ذخیره برای بعد»
  @Get('chat/:conversationId/saved-products')
  getSavedProductIds(
    @Param('conversationId') conversationId: string,
    @Headers('x-session-token') sessionToken: string,
  ) {
    return this.salesAgentService.getSavedProductIds(
      conversationId,
      sessionToken,
    );
  }

  @Get('chat/:conversationId')
  getConversation(
    @Param('conversationId') conversationId: string,
    @Headers('x-session-token') sessionToken: string,
  ) {
    return this.salesAgentService.getConversation(conversationId, sessionToken);
  }

  // docs/PRD-sales-agent-response-strategy-ab.md بخش ۹ — سوییچ دستی خریدار برای تست زنده‌ی
  // Track A/B، فعلاً فقط برای تست، نه قابلیت نهایی
  @Post('chat/:conversationId/response-strategy')
  setResponseStrategy(
    @Param('conversationId') conversationId: string,
    @Headers('x-session-token') sessionToken: string,
    @Body() dto: SetResponseStrategyDto,
  ) {
    return this.salesAgentService.setResponseStrategy(
      conversationId,
      sessionToken,
      dto.responseStrategy,
    );
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
    // فیدبک کاربر ۱۴۰۵/۰۷/۱۲ — sales-agent-voice.processor.ts downloadAndStore حالا WAV
    // خروجی Kie را به MP3 ترنسکود می‌کند (sendAudio تلگرام فقط MP3/M4A واقعی را می‌پذیرد)
    res.setHeader('Content-Type', 'audio/mpeg');
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

  // docs/PRD-product-strategy-and-roadmap.md بخش ۵.۱۴ — عکس پروفایل فروشگاه؛ عیناً همون الگوی
  // getProductImage بالا (بدون auth، باید در <img> مرورگر مشتری ناشناس و در فچ سرورهای تلگرام
  // هم لود شود)
  @SkipThrottle()
  @Get('stores/:storeId/logo/:key')
  async getStoreLogo(
    @Param('storeId') storeId: string,
    @Param('key') key: string,
    @Res() res: Response,
  ) {
    const { buffer, mimeType } = await this.storeService.getStoreLogo(
      storeId,
      key,
    );
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buffer);
  }

  // docs/PRD-product-video.md — محتوای عمومی ویترین (بدون auth)، با پشتیبانی Range request
  // (عیناً الگوی nivo-cal-public.controller.ts) چون ویدیو برخلاف عکس بدون seek تجربه‌ی بدی
  // دارد؛ همیشه mp4 است (normalizeVideoForProviders در store.service.ts)
  @SkipThrottle()
  @Get('products/:productId/video/:key')
  async getProductVideo(
    @Param('productId') productId: string,
    @Param('key') key: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    await this.storeService.assertProductVideoKey(productId, key);

    let size: number;
    try {
      const stat = await this.storage.statObject(key);
      size = stat.size;
    } catch {
      throw new NotFoundException(fa.store.videoNotFound);
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Accept-Ranges', 'bytes');

    const match = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : size - 1;
      const stream = await this.storage.getObjectStream(key, { start, end });
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      stream.pipe(res);
      return;
    }

    res.setHeader('Content-Length', String(size));
    const stream = await this.storage.getObjectStream(key);
    stream.pipe(res);
  }

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۴.۲ — سرو رسانه‌ی نظرات
  // تاییدشده؛ عمومی (بدون auth، مثل getProductImage/getProductVideo بالا) چون محتوای نمایشی
  // عمومی است، فقط مالکیت/تاییدشدگی در سرویس چک می‌شود. برخلاف ویدیوی محصول، ویدیوی نظر
  // transcode نمی‌شود، پس پسوند واقعی فایل تعیین‌کننده‌ی Content-Type است
  @SkipThrottle()
  @Get('comments/:commentId/media/:key')
  async getReviewMedia(
    @Param('commentId') commentId: string,
    @Param('key') key: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    const kind = await this.comments.assertReviewMediaKey(commentId, key);
    const ext = key.split('.').pop() ?? '';

    if (kind === 'video') {
      let size: number;
      try {
        const stat = await this.storage.statObject(key);
        size = stat.size;
      } catch {
        throw new NotFoundException(fa.store.reviewMediaNotFound);
      }
      res.setHeader('Content-Type', `video/${ext}`);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Accept-Ranges', 'bytes');
      const match = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
      if (match) {
        const start = Number(match[1]);
        const end = match[2] ? Number(match[2]) : size - 1;
        const stream = await this.storage.getObjectStream(key, { start, end });
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', String(end - start + 1));
        stream.pipe(res);
        return;
      }
      res.setHeader('Content-Length', String(size));
      const stream = await this.storage.getObjectStream(key);
      stream.pipe(res);
      return;
    }

    const buffer = await this.storage.downloadImage(key);
    const mimeType =
      kind === 'audio'
        ? `audio/${ext === 'mp3' ? 'mpeg' : ext}`
        : mimeTypeForExt(ext);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buffer);
  }
}
