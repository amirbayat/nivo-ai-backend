import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { MediaTranscodeService } from '../../common/services/media-transcode.service';
import { AsrService } from '../../common/services/asr.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import { ConversationEngineService } from './conversation-engine.service';
import { pickVariant } from './model-variants';
import { fa } from '../../i18n/fa';
import type { SendMessageDto } from './dto/send-message.dto';
import type { EngineResult } from './sales-agent.types';

@Injectable()
export class SalesAgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: ConversationEngineService,
    private readonly storage: StorageService,
    private readonly mediaTranscode: MediaTranscodeService,
    private readonly asr: AsrService,
    private readonly aiProvider: AiProviderService,
  ) {}

  // productId اختیاری — لینک اختصاصی یک محصول (فروشنده در استوری گذاشته)؛ اگر معتبر و
  // متعلق به همین فروشگاه باشد، اولین پاسخ مکالمه مستقیم همان محصول را نشان می‌دهد
  // (بدون NLU) و در همین پاسخ startChat برمی‌گردد — فرانت مجبور نیست یک کیک‌آف عمومی
  // جدا بفرستد
  async startChat(slug: string, productId?: string) {
    const store = await this.prisma.store.findUnique({ where: { slug } });
    if (!store || store.status !== 'ACTIVE')
      throw new NotFoundException(fa.store.notFound);

    const sessionToken = crypto.randomUUID();
    const customer = await this.prisma.customer.create({
      data: {
        storeId: store.id,
        sessionToken,
        salesConversation: {
          create: { storeId: store.id, abVariant: pickVariant() },
        },
      },
      include: { salesConversation: true },
    });

    const conversationId = customer.salesConversation!.id;

    let initial: (EngineResult & { voiceEventId?: string }) | undefined;
    if (productId) {
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
      });
      if (product && product.storeId === store.id) {
        const conversation = await this.prisma.salesConversation.findUnique({
          where: { id: conversationId },
          include: { store: true },
        });
        const shown = await this.engine.showProduct(conversation!, product);
        initial = await this.attachVoicePending(conversationId, shown);
      }
    }

    return {
      conversationId,
      sessionToken,
      storeName: store.name,
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

    const ext = file.originalname.split('.').pop() || 'webm';
    const mp3Buffer = await this.mediaTranscode.extractAudio(file.buffer, ext);
    const transcript = await this.asr.transcribeWithFallback(
      mp3Buffer,
      this.aiProvider.sharedApiKey,
      'fa',
    );
    const result = await this.engine.handleMessage(
      conversation,
      transcript.text,
    );
    const withVoice = await this.attachVoicePending(conversationId, result);
    // متن تبدیل‌شده به فرانت هم برمی‌گردد تا حباب «مشتری» واقعی (نه ساختگی) نشان داده شود —
    // بدون این، کلاینت اصلاً نمی‌داند ASR چه چیزی شنیده
    return { ...withVoice, transcript: transcript.text };
  }

  // سرو فایل صوتی — عمومی + کلید غیرقابل‌حدس (همان الگوی محصول عمومی)، نه session-token، چون
  // این endpoint باید هم از مرورگر خریدار هم مستقیم توسط سرورهای تلگرام (sendAudio با URL)
  // قابل‌fetch باشد؛ عضویت با چک این‌که کلید واقعاً روی یک AGENT_REPLY همین مکالمه نشسته تامین می‌شود
  async getVoiceAudio(conversationId: string, key: string): Promise<Buffer> {
    const events = await this.prisma.conversationEvent.findMany({
      where: { conversationId, type: 'AGENT_REPLY' },
      select: { payload: true },
    });
    const owns = events.some(
      (e) => (e.payload as { voiceKey?: string })?.voiceKey === key,
    );
    if (!owns) throw new NotFoundException(fa.salesAgent.conversationNotFound);
    return this.storage.downloadImage(key);
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
      storeName: conversation.store.name,
      events,
    };
  }
}
