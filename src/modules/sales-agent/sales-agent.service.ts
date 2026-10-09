import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import type { BillingMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { SmsService } from '../../sms/sms.service';
import { normalizePhone } from '../../common/utils/normalize-phone';
import { StorageService } from '../../storage/storage.service';
import { mimeTypeForExt } from '../../common/validators/chat-image.validator';
import { MediaTranscodeService } from '../../common/services/media-transcode.service';
import {
  AsrService,
  VOICE_MESSAGE_ASR_CHAIN,
} from '../../common/services/asr.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import {
  ConversationEngineService,
  PRODUCT_VARIANT_INCLUDE,
} from './conversation-engine.service';
import { CreditService } from './credit.service';
import {
  pickVariant,
  pickVoiceVariant,
  pickResponseStrategy,
} from './model-variants';
import { getSalesAgentGlobalConfig } from './sales-agent-global-config.util';
import { buildAsrVocabHint } from './asr-vocab-hint';
import { reattachReceiptIfOrderOpen } from './receipt-reattach.util';
import { CommentsService } from '../comments/comments.service';
import type { SubmitCommentDto } from './dto/submit-comment.dto';
import {
  buildHistoryEntry,
  type ConversationHistoryEntry,
} from './conversation-history.util';
import { fa } from '../../i18n/fa';
import type { SendMessageDto } from './dto/send-message.dto';
import type { EngineResult } from './sales-agent.types';

@Injectable()
export class SalesAgentService {
  private readonly logger = new Logger(SalesAgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: ConversationEngineService,
    private readonly storage: StorageService,
    private readonly mediaTranscode: MediaTranscodeService,
    private readonly asr: AsrService,
    private readonly aiProvider: AiProviderService,
    private readonly creditService: CreditService,
    private readonly redis: RedisService,
    private readonly sms: SmsService,
    private readonly comments: CommentsService,
  ) {}

  // productId اختیاری — لینک اختصاصی یک محصول (فروشنده در استوری گذاشته)؛ اگر معتبر و
  // متعلق به همین فروشگاه باشد، اولین پاسخ مکالمه مستقیم همان محصول را نشان می‌دهد
  // (بدون NLU) و در همین پاسخ startChat برمی‌گردد — فرانت مجبور نیست یک کیک‌آف عمومی
  // جدا بفرستد
  async startChat(slug: string, productId?: string) {
    const store = await this.prisma.store.findUnique({ where: { slug } });
    if (!store || store.status !== 'ACTIVE')
      throw new NotFoundException(fa.store.notFound);

    // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۶.۳ — اگر این اولین چتِ اولین
    // خریدار همین فروشگاه است، قبل از decideBillingMode دوره‌ی آزمایشی گرنت می‌شود
    await this.creditService.grantTrialIfFirstChat(store.id);
    // docs/PRD-seller-credit-billing.md — یک‌بار همین‌جا تعیین می‌شود، تا آخر عمر مکالمه ثابت می‌ماند
    const billingMode = await this.creditService.decideBillingMode(store.id);
    const globalConfig = await getSalesAgentGlobalConfig(this.prisma);

    const sessionToken = crypto.randomUUID();
    const customer = await this.prisma.customer.create({
      data: {
        storeId: store.id,
        sessionToken,
        salesConversations: {
          create: {
            storeId: store.id,
            abVariant: pickVariant(globalConfig.forcedModelVariant),
            voiceVariant: pickVoiceVariant(),
            responseStrategy: pickResponseStrategy(),
            billingMode,
          },
        },
      },
      include: { salesConversations: true },
    });

    const conversationId = customer.salesConversations[0].id;
    const initial = await this.buildInitialReply(
      conversationId,
      store.id,
      billingMode,
      productId,
    );

    return {
      conversationId,
      sessionToken,
      storeId: store.id,
      storeName: store.name,
      storeLogoKey: store.logoImageKey,
      // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md — فرانت با این فلگ نوار دمو
      // را روی صفحه‌ی چت نشان می‌دهد؛ قبلاً این صفحه اصلاً نمی‌دانست فروشگاه دموست یا نه
      isDemo: store.isDemo,
      responseStrategy: customer.salesConversations[0].responseStrategy,
      ...(initial
        ? {
            initialReply: initial.reply,
            initialUiBlocks: initial.uiBlocks,
            initialState: initial.state,
            initialVoiceEventId: initial.voiceEventId,
          }
        : {}),
    };
  }

  // docs/PRD-conversation-history.md — «گفتگوی جدید»: برخلاف startChat هیچ Customer تازه‌ای
  // ساخته نمی‌شود (پس در سهمیه‌ی روزانه‌ی ۱۰ خریدار جدید هم شمرده نمی‌شود)، همان Customer/
  // sessionToken می‌ماند؛ فقط مکالمه‌ی فعلی آرشیو و یک SalesConversation تازه برایش ساخته می‌شود
  async restartConversation(conversationId: string, sessionToken: string) {
    const conversation = await this.loadOwned(conversationId, sessionToken);
    const billingMode = await this.creditService.decideBillingMode(
      conversation.storeId,
    );
    const globalConfig = await getSalesAgentGlobalConfig(this.prisma);

    const fresh = await this.prisma.$transaction(async (tx) => {
      await tx.salesConversation.update({
        where: { id: conversationId },
        data: { archivedAt: new Date() },
      });
      return tx.salesConversation.create({
        data: {
          storeId: conversation.storeId,
          customerId: conversation.customerId,
          abVariant: pickVariant(globalConfig.forcedModelVariant),
          voiceVariant: pickVoiceVariant(),
          responseStrategy: pickResponseStrategy(),
          billingMode,
        },
      });
    });

    const initial = await this.buildInitialReply(
      fresh.id,
      conversation.storeId,
      billingMode,
    );

    return {
      conversationId: fresh.id,
      sessionToken,
      storeId: conversation.storeId,
      storeName: conversation.store.name,
      storeLogoKey: conversation.store.logoImageKey,
      isDemo: conversation.store.isDemo,
      responseStrategy: fresh.responseStrategy,
      ...(initial
        ? {
            initialReply: initial.reply,
            initialUiBlocks: initial.uiBlocks,
            initialState: initial.state,
            initialVoiceEventId: initial.voiceEventId,
          }
        : {}),
    };
  }

  // مشترک بین startChat/restartConversation — لینک اختصاصی محصول یا اعلام BLOCKED، هر دو
  // نیازمند یک پاسخ AI فوری قبل از برگرداندن خودِ conversationId به فرانت هستند
  private async buildInitialReply(
    conversationId: string,
    storeId: string,
    billingMode: BillingMode,
    productId?: string,
  ): Promise<(EngineResult & { voiceEventId?: string }) | undefined> {
    if (!productId && billingMode !== 'BLOCKED') return undefined;
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
      include: { store: true },
    });
    if (billingMode === 'BLOCKED') {
      const blocked = await this.engine.announceBillingBlocked(conversation!);
      return this.attachVoicePending(conversationId, blocked);
    }
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: PRODUCT_VARIANT_INCLUDE,
    });
    if (product && product.storeId === storeId) {
      const shown = await this.engine.showProduct(conversation!, product);
      return this.attachVoicePending(conversationId, shown);
    }
    return undefined;
  }

  // docs/PRD-conversation-history.md بخش ۳ — همه‌ی مکالمات (فعال+آرشیوشده) همین یک Customer
  // (شناسایی از روی sessionToken، نه JWT چون Customer یک User نیست)، تازه‌ترین اول
  async getCustomerHistory(
    slug: string,
    sessionToken: string,
  ): Promise<ConversationHistoryEntry[]> {
    const store = await this.prisma.store.findUnique({ where: { slug } });
    if (!store) throw new NotFoundException(fa.store.notFound);
    if (!sessionToken) return [];
    const customer = await this.prisma.customer.findUnique({
      where: { storeId_sessionToken: { storeId: store.id, sessionToken } },
    });
    if (!customer) return [];
    const conversations = await this.prisma.salesConversation.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: 'desc' },
    });
    return conversations.map((c) => buildHistoryEntry(c, store.name));
  }

  // مالکیت مکالمه را با sessionToken چک می‌کند — الگوی ownership گام ۰ (store.service.ts
  // getOwned)، فقط اینجا کلید session است، نه JWT، چون Customer یک User نیست
  private async loadOwned(conversationId: string, sessionToken: string) {
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
      include: { store: true, customer: true },
    });
    if (!conversation)
      throw new NotFoundException(fa.salesAgent.conversationNotFound);
    if (!sessionToken || conversation.customer.sessionToken !== sessionToken) {
      throw new ForbiddenException(fa.salesAgent.invalidSession);
    }
    return conversation;
  }

  async sendMessage(
    conversationId: string,
    sessionToken: string,
    dto: SendMessageDto,
  ) {
    const conversation = await this.loadOwned(conversationId, sessionToken);

    // مکالمه‌ای که به انسان سپرده شده دیگر نباید از NLU/موتور مکالمه رد شود — فقط پیام
    // مشتری لاگ می‌شود تا فروشنده در تب «نیاز به توجه» ببیندش (خودش جواب می‌دهد)
    if (conversation.isMutedForHuman) {
      await this.prisma.conversationEvent.create({
        data: {
          conversationId: conversation.id,
          type: 'CUSTOMER_MESSAGE',
          payload: { text: dto.message ?? '' },
        },
      });
      return { reply: '', uiBlocks: [], state: conversation.currentState };
    }

    let result: EngineResult;
    if (dto.action) {
      result = await this.engine.handleAction(conversation, dto.action);
    } else {
      if (!dto.message) throw new BadRequestException(fa.errors.validation);
      result = await this.engine.handleMessage(conversation, dto.message);
    }
    return this.attachVoicePending(conversationId, result);
  }

  async submitReceipt(
    conversationId: string,
    sessionToken: string,
    file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException(fa.errors.validation);
    if (!file.mimetype.startsWith('image/'))
      throw new BadRequestException(fa.errors.validation);

    const conversation = await this.loadOwned(conversationId, sessionToken);
    const ext = file.mimetype.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
    const key = await this.storage.uploadImage(
      file.buffer,
      ext,
      conversation.id,
    );
    const result = await this.engine.handleReceiptUpload(conversation, key);
    return this.attachVoicePending(conversationId, result);
  }

  // خریدار - وقتی مکالمه muted است (صحبت مستقیم با فروشنده، مثل HANDOFF_HUMAN/REJECTED) یا
  // منتظر نظر است (awaitingReview — docs/PRD-order-status-chat-tool-and-fulfillment-delay-reviews.md
  // بخش ۳.۱) می‌تواند عکس بفرستد؛ موتور مکالمه‌ی رباتی اصلاً برای عکسِ غیر-رسید طراحی نشده. حالت
  // اول دقیقاً همان مسیر CUSTOMER_MESSAGE متنیِ muted در sendMessage بالا را تکرار می‌کند؛ حالت
  // دوم مستقیم به یک ProductComment تبدیل می‌شود
  async submitImageMessage(
    conversationId: string,
    sessionToken: string,
    file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException(fa.errors.validation);
    if (!file.mimetype.startsWith('image/'))
      throw new BadRequestException(fa.errors.validation);

    const conversation = await this.loadOwned(conversationId, sessionToken);
    const awaitingReview = (
      conversation.contextData as { awaitingReview?: boolean } | null
    )?.awaitingReview;
    if (!conversation.isMutedForHuman && !awaitingReview) {
      throw new BadRequestException(fa.errors.validation);
    }

    const ext = file.mimetype.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
    const imageKey = await this.storage.uploadImage(
      file.buffer,
      ext,
      conversation.id,
    );

    if (awaitingReview) {
      const result = await this.engine.submitReviewMedia(conversation, {
        imageKey,
      });
      return this.attachVoicePending(conversationId, result);
    }

    const reattachedToOrder = await reattachReceiptIfOrderOpen(
      this.prisma,
      conversation.id,
      imageKey,
    );
    await this.prisma.conversationEvent.create({
      data: {
        conversationId: conversation.id,
        type: 'CUSTOMER_MESSAGE',
        payload: {
          imageKey,
          ...(reattachedToOrder ? { reattachedToOrder } : {}),
        },
      },
    });
    return { reply: '', uiBlocks: [], state: conversation.currentState };
  }

  // docs/PRD-order-status-chat-tool-and-fulfillment-delay-reviews.md بخش ۳.۱ — هم‌الگوی
  // submitImageMessage بالا، برای ویدیو؛ قبلاً هیچ endpointـی برای ویدیوی مسیر چت نبود (فقط
  // مدال مستقل نظرات فایل‌پیکر ویدیو داشت). سقف حجم همان SalesAgentService.COMMENT_MEDIA_MAX_BYTES.video
  async submitVideoMessage(
    conversationId: string,
    sessionToken: string,
    file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException(fa.errors.validation);
    if (!file.mimetype.startsWith('video/'))
      throw new BadRequestException(fa.errors.validation);
    if (file.size > SalesAgentService.COMMENT_MEDIA_MAX_BYTES.video) {
      throw new BadRequestException(fa.errors.validation);
    }

    const conversation = await this.loadOwned(conversationId, sessionToken);
    const awaitingReview = (
      conversation.contextData as { awaitingReview?: boolean } | null
    )?.awaitingReview;
    if (!conversation.isMutedForHuman && !awaitingReview) {
      throw new BadRequestException(fa.errors.validation);
    }

    const ext = file.mimetype.split('/')[1] ?? 'mp4';
    const videoKey = await this.storage.uploadImage(
      file.buffer,
      ext,
      conversation.id,
    );

    if (awaitingReview) {
      const result = await this.engine.submitReviewMedia(conversation, {
        videoKey,
      });
      return this.attachVoicePending(conversationId, result);
    }

    await this.prisma.conversationEvent.create({
      data: {
        conversationId: conversation.id,
        type: 'CUSTOMER_MESSAGE',
        payload: { videoKey },
      },
    });
    return { reply: '', uiBlocks: [], state: conversation.currentState };
  }

  // docs/PRD-buyer-orders-page-and-direct-order.md بخش ۲.۲ — صفحه‌ی مستقل «سفارش‌های من»،
  // بدون AI/engine؛ عیناً همون query که VIEW_ORDERS داخل conversation-engine.service.ts استفاده
  // می‌کند (مقایسه‌شده تا کانال چت و صفحه‌ی مستقل داده‌ی یکسان نشان بدهند)، فقط به یک GET معمولی
  // منتقل شده. distinctProductId هم عیناً منطق requestReviewFollowUp (store.service.ts) است —
  // برای پیش‌پرکردن productId فرم «ثبت نظر» وقتی سفارش دقیقاً یک محصول داشت
  async listMyOrders(conversationId: string, sessionToken: string) {
    const conversation = await this.loadOwned(conversationId, sessionToken);
    const orders = await this.prisma.order.findMany({
      where: { conversation: { customerId: conversation.customerId } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return orders.map((o) => {
      const items = o.items as {
        productId: string;
        name: string;
        unitPrice: number;
        qty: number;
      }[];
      const distinctProductIds = [...new Set(items.map((i) => i.productId))];
      return {
        id: o.id,
        createdAt: o.createdAt.toISOString(),
        items,
        totalAmount: o.totalAmount,
        status: o.status,
        distinctProductId:
          distinctProductIds.length === 1 ? distinctProductIds[0] : null,
      };
    });
  }

  // docs/PRD-buyer-orders-page-and-direct-order.md بخش ۲.۳ — ثبت نظر مستقیم، مستقل از پیام
  // پیگیریِ چت (awaitingReview/doSubmitComment که دست‌نخورده می‌ماند). فقط خریدارهایی که واقعاً
  // سفارش تاییدشده دارند (و اگر productId داده شده، آن محصول دقیقاً در یکی از آن سفارش‌ها بوده)
  // مجاز به ثبت نظرند — جلوگیری از نظر جعلی کسی که اصلاً خرید نکرده
  async submitDirectComment(
    conversationId: string,
    sessionToken: string,
    dto: SubmitCommentDto,
  ) {
    const conversation = await this.loadOwned(conversationId, sessionToken);

    const approvedOrders = await this.prisma.order.findMany({
      where: {
        status: 'APPROVED',
        conversation: { customerId: conversation.customerId },
      },
      select: { items: true },
    });
    const hasPurchased = dto.productId
      ? approvedOrders.some((o) =>
          (o.items as { productId: string }[]).some(
            (i) => i.productId === dto.productId,
          ),
        )
      : approvedOrders.length > 0;
    if (!hasPurchased) {
      throw new ForbiddenException(fa.salesAgent.commentRequiresPurchase);
    }

    await this.comments.submitComment({
      storeId: conversation.storeId,
      customerId: conversation.customerId,
      productId: dto.productId ?? null,
      text: dto.text,
      rating: dto.rating,
      imageKey: dto.imageKey,
      videoKey: dto.videoKey,
      audioKey: dto.audioKey,
    });
    return { ok: true };
  }

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۴.۲ — آپلود عکس/ویدیو/صدای
  // نظر، قبل از submitDirectComment بالا؛ عیناً الگوی submitReceipt (همان storage.uploadImage
  // برای هر سه نوع، طبق کانونشن موجود پروژه — بخش A8 بررسی‌شده)
  private static readonly COMMENT_MEDIA_MAX_BYTES: Record<string, number> = {
    image: 5 * 1024 * 1024,
    video: 20 * 1024 * 1024,
    audio: 8 * 1024 * 1024,
  };

  async submitCommentMedia(
    conversationId: string,
    sessionToken: string,
    file: Express.Multer.File | undefined,
  ): Promise<{ key: string; kind: 'image' | 'video' | 'audio' }> {
    if (!file) throw new BadRequestException(fa.errors.validation);
    const kind = file.mimetype.startsWith('image/')
      ? 'image'
      : file.mimetype.startsWith('video/')
        ? 'video'
        : file.mimetype.startsWith('audio/')
          ? 'audio'
          : null;
    if (!kind) throw new BadRequestException(fa.errors.validation);
    if (file.size > SalesAgentService.COMMENT_MEDIA_MAX_BYTES[kind]) {
      throw new BadRequestException(fa.errors.validation);
    }

    const conversation = await this.loadOwned(conversationId, sessionToken);
    // برای image همون نرمال‌سازی jpeg→jpg موجود؛ برای video/audio پسوند واقعی حفظ می‌شود چون
    // (برخلاف ویدیوی محصول) این‌جا transcode نمی‌کنیم — پسوند همان چیزی است که در Content-Type
    // سرو دوباره استفاده می‌شود (getReviewMedia)
    const ext =
      kind === 'image'
        ? (file.mimetype.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg')
        : (file.mimetype.split('/')[1] ?? 'bin');
    const key = await this.storage.uploadImage(
      file.buffer,
      ext,
      conversation.id,
    );
    return { key, kind };
  }

  // docs/PRD-buyer-phone-otp-registration.md — برخلاف marketplace.service.ts's sendOtp/verifyOtp
  // (که یک JWT جدید برای دسترسی چندفروشگاهی صادر می‌کند)، این‌جا فقط باید مالکیت شماره برای
  // همین مکالمه‌ی در حال اجرا (که مالکیتش با sessionToken قبلاً اثبات شده) تایید شود — بدون
  // توکن جدید. الگوی Redis TTL/rate-limit عیناً از marketplace.service.ts کپی شده، فقط با
  // پیشوند کلید جدا تا اسپم یک فروشگاه محدود به خودش بماند
  private otpKey(storeId: string, phone: string) {
    return `shopBuyerOtp:${storeId}:${phone}`;
  }
  private otpRateKey(storeId: string, phone: string) {
    return `shopBuyerOtp:rate:${storeId}:${phone}`;
  }
  private otpAttemptKey(storeId: string, phone: string) {
    return `shopBuyerOtp:attempt:${storeId}:${phone}`;
  }

  async sendBuyerOtp(
    conversationId: string,
    sessionToken: string,
    rawPhone: string,
  ): Promise<{ message: string }> {
    const conversation = await this.loadOwned(conversationId, sessionToken);
    const phone = normalizePhone(rawPhone);

    const rateKey = this.otpRateKey(conversation.storeId, phone);
    const sends = await this.redis.incr(rateKey);
    if (sends === 1) await this.redis.expire(rateKey, 600);
    if (sends > 3) {
      throw new HttpException(fa.auth.otpTooManyRequests(10), 429);
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await this.redis.set(
      this.otpKey(conversation.storeId, phone),
      code,
      'EX',
      120,
    );
    await this.sms.sendOtp(phone, code);

    return { message: fa.auth.otpSent };
  }

  async verifyBuyerOtp(
    conversationId: string,
    sessionToken: string,
    rawPhone: string,
    code: string,
    fullName?: string,
  ): Promise<{ message: string }> {
    const conversation = await this.loadOwned(conversationId, sessionToken);
    const phone = normalizePhone(rawPhone);

    const attemptKey = this.otpAttemptKey(conversation.storeId, phone);
    const attempts = await this.redis.incr(attemptKey);
    if (attempts === 1) await this.redis.expire(attemptKey, 1800);
    if (attempts > 5) {
      throw new HttpException(fa.auth.otpTooManyAttempts(30), 429);
    }

    const otpRedisKey = this.otpKey(conversation.storeId, phone);
    const stored = await this.redis.get(otpRedisKey);
    if (!stored) throw new UnauthorizedException(fa.auth.otpExpired);
    if (stored !== code) throw new UnauthorizedException(fa.auth.otpInvalid);

    await this.redis.del(
      otpRedisKey,
      this.otpRateKey(conversation.storeId, phone),
      attemptKey,
    );

    await this.prisma.customer.update({
      where: { id: conversation.customerId },
      data: {
        phone,
        phoneVerifiedAt: new Date(),
        ...(fullName ? { fullName } : {}),
      },
    });

    return { message: fa.salesAgent.registerSuccess };
  }

  // docs/PRD-sales-agent-voice.md بخش ۱.۲ — بعد از هر پاسخ، اگر همان پاسخ (تازه لاگ‌شده)
  // voicePending دارد، شناسه‌ی همان AGENT_REPLY event را به کلاینت می‌دهیم تا کوتاه (وب) پول
  // کند؛ تلگرام نیازی به این ندارد چون sales-agent-voice.processor.ts مستقیم برایش push می‌کند
  private async attachVoicePending(
    conversationId: string,
    result: EngineResult,
  ): Promise<EngineResult & { voiceEventId?: string; awaitingReview: boolean }> {
    const [latest, conversation] = await Promise.all([
      this.prisma.conversationEvent.findFirst({
        where: { conversationId, type: 'AGENT_REPLY' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, payload: true },
      }),
      this.prisma.salesConversation.findUnique({
        where: { id: conversationId },
        select: { contextData: true },
      }),
    ]);
    const pending = (latest?.payload as { voicePending?: boolean })
      ?.voicePending;
    // docs/PRD-order-status-chat-tool-and-fulfillment-delay-reviews.md بخش ۳.۱ — فرانت از
    // همین پاسخ‌ها (sendMessage/submitImageMessage/submitVoiceMessage/submitVideoMessage) هم
    // باید بفهمد الان منتظر نظر است یا نه، نه فقط از GET getConversation
    const awaitingReview = !!(
      conversation?.contextData as { awaitingReview?: boolean } | null
    )?.awaitingReview;
    return {
      ...result,
      ...(pending ? { voiceEventId: latest!.id } : {}),
      awaitingReview,
    };
  }

  // وویس ورودی مشتری (بخش ۲.۲) — همان الگوی extractAudio→ASR که
  // caption-transcribe.processor.ts استفاده می‌کند؛ متن خروجی دقیقاً مثل تایپ‌شده وارد
  // handleMessage می‌شود (CUSTOMER_MESSAGE لاگ‌شده هم همان متن تبدیل‌شده است، برای شفافیت)
  async submitVoiceMessage(
    conversationId: string,
    sessionToken: string,
    file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException(fa.errors.validation);
    if (!file.mimetype.startsWith('audio/') && file.mimetype !== 'video/webm') {
      throw new BadRequestException(fa.errors.validation);
    }

    const conversation = await this.loadOwned(conversationId, sessionToken);
    if (conversation.isMutedForHuman) {
      throw new BadRequestException(fa.salesAgent.invalidSession);
    }

    // فیدبک کاربر: قبلاً هر خطای extractAudio/ASR (مثلاً یک 400 غیرمنتظره از یکی از مدل‌های
    // VOICE_MESSAGE_ASR_CHAIN — طبق asr.service.ts فقط خطای ۴۲۹/۵xx باعث fallback می‌شود، نه
    // هر خطا) بدون catch تا کنترلر بالا می‌رفت و یک 500 خام («خطای داخلی سرور») به مشتری
    // می‌رسید، بدون هیچ راهنمایی. حالا مثل مسیر مشابه تلگرام (telegram.service.ts handleVoice)
    // خطا لاگ می‌شود (جزئیات واقعی — مدل/status/requestId از قبل داخل asr.service.ts لاگ
    // می‌شود) و یک پاسخ عادیِ شکل-مکالمه (نه یک HTTP error) با راهنمایی برمی‌گردد.
    let transcriptText: string;
    try {
      const ext = file.originalname.split('.').pop() || 'webm';
      this.logger.log(
        `submitVoiceMessage conversation=${conversationId} upload mimetype=${file.mimetype} ext=${ext} bytes=${file.buffer.length}`,
      );
      const mp3Buffer = await this.mediaTranscode.extractAudio(
        file.buffer,
        ext,
      );
      this.logger.log(
        `submitVoiceMessage conversation=${conversationId} extractAudio bytes=${file.buffer.length}→${mp3Buffer.length}`,
      );
      const products = await this.prisma.product.findMany({
        where: { storeId: conversation.storeId },
        select: { name: true },
        take: 8,
      });
      const vocabHint = buildAsrVocabHint(
        conversation.store.name,
        products.map((p) => p.name),
      );
      // فقط متن نهایی لازم است (نه timestamp کلمه‌ای) — VOICE_MESSAGE_ASR_CHAIN طبق
      // فیدبک کاربر ۱۴۰۵/۰۷/۰۱ (دقت whisper هنوز ضعیف است) chirp-3 را هم امتحان می‌کند
      const transcript = await this.asr.transcribeWithFallback(
        mp3Buffer,
        this.aiProvider.sharedApiKey,
        'fa',
        vocabHint,
        VOICE_MESSAGE_ASR_CHAIN,
        false,
      );
      transcriptText = transcript.text.trim();
      this.logger.log(
        `submitVoiceMessage conversation=${conversationId} transcribed model=${transcript.modelUsed} text="${transcriptText.slice(0, 200)}"`,
      );
    } catch (err) {
      this.logger.error(
        `submitVoiceMessage failed (conversation=${conversationId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
      );
      return {
        reply: fa.salesAgent.voiceProcessingFailed,
        uiBlocks: [],
        state: conversation.currentState,
        transcript: '',
      };
    }

    if (!transcriptText) {
      return {
        reply: fa.salesAgent.voiceProcessingFailed,
        uiBlocks: [],
        state: conversation.currentState,
        transcript: '',
      };
    }

    // docs/PRD-order-status-chat-tool-and-fulfillment-delay-reviews.md بخش ۳.۱/۳.۳ — وقتی
    // مکالمه منتظر نظر است، برخلاف مسیر عادی (زیر)، خودِ فایل صوت هم آپلود و با متن رونویسی‌شده
    // روی یک ProductComment ذخیره می‌شود (هم فایل هم متن — نه فقط متن مثل قبل). برای پیام صوتی
    // عادی به ربات فروش (awaitingReview نبود) ذخیره‌ی صوت خام لازم نیست، همان رفتار قبلی می‌ماند
    const awaitingReview = (
      conversation.contextData as { awaitingReview?: boolean } | null
    )?.awaitingReview;
    if (awaitingReview) {
      const audioExt = file.originalname.split('.').pop() || 'webm';
      const audioKey = await this.storage.uploadImage(
        file.buffer,
        audioExt,
        conversation.id,
      );
      const result = await this.engine.submitReviewMedia(conversation, {
        text: transcriptText,
        audioKey,
      });
      const withVoice = await this.attachVoicePending(conversationId, result);
      return { ...withVoice, transcript: transcriptText };
    }

    const result = await this.engine.handleMessage(
      conversation,
      transcriptText,
    );
    const withVoice = await this.attachVoicePending(conversationId, result);
    // متن تبدیل‌شده به فرانت هم برمی‌گردد تا حباب «مشتری» واقعی (نه ساختگی) نشان داده شود —
    // بدون این، کلاینت اصلاً نمی‌داند ASR چه چیزی شنیده
    return { ...withVoice, transcript: transcriptText };
  }

  // سرو فایل صوتی — عمومی + کلید غیرقابل‌حدس (همان الگوی محصول عمومی)، نه session-token، چون
  // این endpoint باید هم از مرورگر خریدار هم مستقیم توسط سرورهای تلگرام (sendAudio با URL)
  // قابل‌fetch باشد؛ عضویت با چک این‌که کلید واقعاً روی یک AGENT_REPLY همین مکالمه نشسته تامین می‌شود
  async getVoiceAudio(conversationId: string, key: string): Promise<Buffer> {
    const events = await this.prisma.conversationEvent.findMany({
      where: { conversationId, type: 'AGENT_REPLY' },
      select: { id: true, payload: true },
    });
    const event = events.find(
      (e) => (e.payload as { voiceKey?: string })?.voiceKey === key,
    );
    if (!event) throw new NotFoundException(fa.salesAgent.conversationNotFound);
    // docs/PRD-sales-agent-voice.md بخش ۶.۵ — این GET هم از وب (audio src) هم از سرورهای تلگرام
    // (sendVoice با URL) فچ می‌شود؛ طبق متن صریح سند، این فقط یک پروکسی ضعیف («دانلود شد») است،
    // نه معادل «شنیده شد» — همان یک‌بار اول ثبت می‌شود، نه هر فچ تکراری (کش هم‌مرورگر کمک می‌کند)
    const payload = event.payload as { voiceDownloadedAt?: string };
    if (!payload.voiceDownloadedAt) {
      await this.prisma.conversationEvent.update({
        where: { id: event.id },
        data: {
          payload: { ...payload, voiceDownloadedAt: new Date().toISOString() },
        },
      });
    }
    return this.storage.downloadImage(key);
  }

  // سرو عکس‌هایی که خریدار در حالت «صحبت با فروشنده» فرستاده — همان الگوی getVoiceAudio
  // بالا (عمومی + کلید غیرقابل‌حدس، عضویت با چک این‌که کلید واقعاً روی یک CUSTOMER_MESSAGE
  // همین مکالمه نشسته)، چون هم چت وب و هم پنل فروشنده بدون JWT/session-token آن را fetch می‌کنند
  async getChatImage(
    conversationId: string,
    key: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const events = await this.prisma.conversationEvent.findMany({
      where: { conversationId, type: 'CUSTOMER_MESSAGE' },
      select: { payload: true },
    });
    // docs/PRD-order-status-chat-tool-and-fulfillment-delay-reviews.md بخش ۳.۱ — ویدیوی چت
    // (submitVideoMessage، فقط در حالت isMutedForHuman لاگ می‌شود) هم از همین endpoint سرو می‌شود
    const found = events.some((e) => {
      const payload = e.payload as { imageKey?: string; videoKey?: string };
      return payload?.imageKey === key || payload?.videoKey === key;
    });
    if (!found) throw new NotFoundException(fa.salesAgent.conversationNotFound);
    const buffer = await this.storage.downloadImage(key);
    const ext = key.split('.').pop() ?? '';
    return { buffer, mimeType: mimeTypeForExt(ext) };
  }

  // docs/PRD-sales-agent-voice.md بخش ۶.۵ — سیگنال واقعی روی وب: onPlay خودِ تگ audio، یک‌بار
  // پینگ می‌زند. برخلاف voiceDownloadedAt بالا، این واقعاً معادل «شنیده شد» است (نه فقط فچ)
  async markVoiceHeard(
    conversationId: string,
    sessionToken: string,
    key: string,
  ): Promise<void> {
    await this.loadOwned(conversationId, sessionToken);
    const events = await this.prisma.conversationEvent.findMany({
      where: { conversationId, type: 'AGENT_REPLY' },
      select: { id: true, payload: true },
    });
    const event = events.find(
      (e) => (e.payload as { voiceKey?: string })?.voiceKey === key,
    );
    if (!event) throw new NotFoundException(fa.salesAgent.conversationNotFound);
    const payload = event.payload as { voiceHeardAt?: string };
    if (payload.voiceHeardAt) return;
    await this.prisma.conversationEvent.update({
      where: { id: event.id },
      data: { payload: { ...payload, voiceHeardAt: new Date().toISOString() } },
    });
  }

  // پول کوتاه وب (حداکثر ۱۵ ثانیه هر ۲ ثانیه، طبق سند) — فقط همون یک event مشخص را چک می‌کند
  async getVoiceStatus(
    conversationId: string,
    sessionToken: string,
    eventId: string,
  ): Promise<{ voiceKey: string | null; pending: boolean }> {
    await this.loadOwned(conversationId, sessionToken);
    const event = await this.prisma.conversationEvent.findUnique({
      where: { id: eventId },
    });
    if (!event || event.conversationId !== conversationId) {
      throw new NotFoundException(fa.salesAgent.conversationNotFound);
    }
    const payload = event.payload as {
      voiceKey?: string;
      voicePending?: boolean;
    };
    return {
      voiceKey: payload.voiceKey ?? null,
      pending: !!payload.voicePending,
    };
  }

  async getConversation(conversationId: string, sessionToken: string) {
    const conversation = await this.loadOwned(conversationId, sessionToken);
    const events = await this.prisma.conversationEvent.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    // docs/PRD-order-status-chat-tool-and-fulfillment-delay-reviews.md بخش ۳.۱ — فرانت باید
    // بداند الان منتظر نظر است یا نه تا دکمه‌های پیوست عکس/ویدیو را نشان بدهد
    const awaitingReview = (
      conversation.contextData as { awaitingReview?: boolean } | null
    )?.awaitingReview;
    return {
      state: conversation.currentState,
      storeId: conversation.storeId,
      storeName: conversation.store.name,
      storeLogoKey: conversation.store.logoImageKey,
      isDemo: conversation.store.isDemo,
      responseStrategy: conversation.responseStrategy,
      awaitingReview: !!awaitingReview,
      events,
    };
  }

  // docs/PRD-panels-and-buyer-ux-design.md بخش ۳.۶ (فاز ۴.۸، مورد ۳) — کدام محصولات این
  // Customer (نه فقط همین مکالمه) «ذخیره برای بعد» کرده، برای نشان‌دادن آیکون پرشده روی کارت/گرید
  async getSavedProductIds(conversationId: string, sessionToken: string) {
    const conversation = await this.loadOwned(conversationId, sessionToken);
    const saved = await this.prisma.savedProduct.findMany({
      where: { customerId: conversation.customerId },
      select: { productId: true },
    });
    return { productIds: saved.map((s) => s.productId) };
  }

  // docs/PRD-sales-agent-response-strategy-ab.md بخش ۹ — سوییچ دستی خریدار (فعلاً فقط برای
  // تست زنده‌ی کاربر، نه یک قابلیت نهایی محصول) بین Track A/B روی همین مکالمه؛ بدون migration
  // چون responseStrategy از قبل روی SalesConversation هست
  async setResponseStrategy(
    conversationId: string,
    sessionToken: string,
    responseStrategy: 'RULE_BASED' | 'SIMPLE_AGENT' | 'FULL_AGENT',
  ) {
    await this.loadOwned(conversationId, sessionToken);
    await this.prisma.salesConversation.update({
      where: { id: conversationId },
      data: { responseStrategy },
    });
    return { responseStrategy };
  }
}
