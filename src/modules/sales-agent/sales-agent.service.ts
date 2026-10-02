import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import type { BillingMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { MediaTranscodeService } from '../../common/services/media-transcode.service';
import {
  AsrService,
  VOICE_MESSAGE_ASR_CHAIN,
} from '../../common/services/asr.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import { ConversationEngineService } from './conversation-engine.service';
import { CreditService } from './credit.service';
import {
  pickVariant,
  pickVoiceVariant,
  pickResponseStrategy,
} from './model-variants';
import { buildAsrVocabHint } from './asr-vocab-hint';
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
  ) {}

  // productId اختیاری — لینک اختصاصی یک محصول (فروشنده در استوری گذاشته)؛ اگر معتبر و
  // متعلق به همین فروشگاه باشد، اولین پاسخ مکالمه مستقیم همان محصول را نشان می‌دهد
  // (بدون NLU) و در همین پاسخ startChat برمی‌گردد — فرانت مجبور نیست یک کیک‌آف عمومی
  // جدا بفرستد
  async startChat(slug: string, productId?: string) {
    const store = await this.prisma.store.findUnique({ where: { slug } });
    if (!store || store.status !== 'ACTIVE')
      throw new NotFoundException(fa.store.notFound);

    // docs/PRD-seller-credit-billing.md — یک‌بار همین‌جا تعیین می‌شود، تا آخر عمر مکالمه ثابت می‌ماند
    const billingMode = await this.creditService.decideBillingMode(store.id);

    const sessionToken = crypto.randomUUID();
    const customer = await this.prisma.customer.create({
      data: {
        storeId: store.id,
        sessionToken,
        salesConversations: {
          create: {
            storeId: store.id,
            abVariant: pickVariant(),
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

    const fresh = await this.prisma.$transaction(async (tx) => {
      await tx.salesConversation.update({
        where: { id: conversationId },
        data: { archivedAt: new Date() },
      });
      return tx.salesConversation.create({
        data: {
          storeId: conversation.storeId,
          customerId: conversation.customerId,
          abVariant: pickVariant(),
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

  // docs/PRD-sales-agent-voice.md بخش ۱.۲ — بعد از هر پاسخ، اگر همان پاسخ (تازه لاگ‌شده)
  // voicePending دارد، شناسه‌ی همان AGENT_REPLY event را به کلاینت می‌دهیم تا کوتاه (وب) پول
  // کند؛ تلگرام نیازی به این ندارد چون sales-agent-voice.processor.ts مستقیم برایش push می‌کند
  private async attachVoicePending(
    conversationId: string,
    result: EngineResult,
  ): Promise<EngineResult & { voiceEventId?: string }> {
    const latest = await this.prisma.conversationEvent.findFirst({
      where: { conversationId, type: 'AGENT_REPLY' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, payload: true },
    });
    const pending = (latest?.payload as { voicePending?: boolean })
      ?.voicePending;
    return pending ? { ...result, voiceEventId: latest!.id } : result;
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
    return {
      state: conversation.currentState,
      storeId: conversation.storeId,
      storeName: conversation.store.name,
      storeLogoKey: conversation.store.logoImageKey,
      responseStrategy: conversation.responseStrategy,
      events,
    };
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
