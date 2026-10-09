import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { streamText, type ModelMessage } from 'ai';
import { PrismaService } from '../../prisma/prisma.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import { KieProviderService } from '../../common/services/kie-provider.service';
import { MediaTranscodeService } from '../../common/services/media-transcode.service';
import { PricingService } from '../usage/pricing.service';
import { StoreService } from '../store/store.service';
import { pickVariant, resolveModel } from '../sales-agent/model-variants';
import { NEUTRAL_VOICE } from '../sales-agent/voice-gender';
import { fa } from '../../i18n/fa';
import { GuideAssistantStreamDto, GuideAssistantTtsDto } from './dto/guide-assistant.dto';
import { getSalesAgentGlobalConfig } from '../sales-agent/sales-agent-global-config.util';

const MAX_USER_MESSAGES = 12;

// docs/PRD-seller-guide-assistant-modal.md بخش ۳.۱/۳.۲ — همون مدل/نرخ ثابت‌شده‌ی
// sales-agent-voice.processor.ts، تکرار عمدی (نه import مستقیم از queue/processors، چون آن
// فایل مختص ConversationEvent/SalesConversation است، نه یک سرویس عمومی قابل‌فراخوانی)
const TTS_MODEL_SLUG = 'google/gemini-3-8-flash-lite-tts';
const TTS_POLL_INTERVAL_MS = 2_000;
const TTS_MAX_POLL_ATTEMPTS = 40; // ~۸۰ ثانیه سقف — این یک فراخوان سینک روی کلیک مودال است
const KIE_USD_PER_CREDIT = 0.005;

@Injectable()
export class GuideAssistantService {
  private readonly logger = new Logger(GuideAssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
    private readonly aiProvider: AiProviderService,
    private readonly kie: KieProviderService,
    private readonly mediaTranscode: MediaTranscodeService,
    private readonly pricing: PricingService,
  ) {}

  // همون چک trial-aware StoreKbService.hasUsableCredit/decrementStoreCredit — آن متدها private
  // هستند، طبق الگوی پذیرفته‌شده‌ی این بخش از کدبیس هر سرویس مصرف‌کننده‌ی AI همین چند خط را
  // خودش نگه می‌دارد (نه یک util مشترک)
  private hasUsableCredit(store: {
    creditBalanceToman: number;
    trialEndsAt: Date | null;
    trialCreditRemainingToman: number;
  }): boolean {
    const trialActive =
      !!store.trialEndsAt &&
      store.trialEndsAt > new Date() &&
      store.trialCreditRemainingToman > 0;
    return store.creditBalanceToman > 0 || trialActive;
  }

  // فیدبک کاربر ۱۴۰۵/۰۷/۱۷ — این مصرفِ خودِ فروشنده است، پس با sellerCostMarkup ضرب می‌شود
  private async decrementStoreCredit(
    storeId: string,
    costToman: number,
  ): Promise<number> {
    const config = await getSalesAgentGlobalConfig(this.prisma);
    const chargedToman = Math.ceil(costToman * config.sellerCostMarkup);
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { trialEndsAt: true, trialCreditRemainingToman: true },
    });
    const trialActive =
      !!store?.trialEndsAt &&
      store.trialEndsAt > new Date() &&
      store.trialCreditRemainingToman > 0;
    await this.prisma.store.update({
      where: { id: storeId },
      data: trialActive
        ? { trialCreditRemainingToman: { decrement: chargedToman } }
        : { creditBalanceToman: { decrement: chargedToman } },
    });
    return chargedToman;
  }

  // docs/PRD-seller-guide-assistant-modal.md بخش ۳.۳ — بدون پرسیست مکالمه (۲.۳)؛ هر درخواست کل
  // تاریخچه را حمل می‌کند. مدل یک‌بار در اولین پیام انتخاب می‌شود (pickVariant) و کلیدش در همون
  // اولین رویداد SSE به فرانت برمی‌گردد تا در درخواست‌های بعدی همین جلسه ثابت بماند (۳.۲)
  async streamChat(
    sellerId: string,
    storeId: string,
    dto: GuideAssistantStreamDto,
    req: Request,
    res: Response,
  ): Promise<void> {
    const store = await this.storeService.getOwned(sellerId, storeId);

    const userMessageCount = dto.messages.filter((m) => m.role === 'user').length;
    if (userMessageCount === 0 || userMessageCount > MAX_USER_MESSAGES) {
      throw new BadRequestException(fa.errors.validation);
    }
    if (!this.hasUsableCredit(store)) {
      throw new BadRequestException(fa.store.insufficientCreditForGuideAssistant);
    }

    const variantKey = dto.modelVariant ?? pickVariant();
    const modelId = resolveModel(variantKey);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ info: 'model', variant: variantKey })}\n\n`);

    const abortController = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) abortController.abort();
    });

    const coreMessages: ModelMessage[] = dto.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const result = streamText({
        model: this.aiProvider.buildClient()(modelId),
        system: dto.systemPrompt,
        messages: coreMessages,
        maxOutputTokens: 2000,
        abortSignal: abortController.signal,
      });

      for await (const chunk of result.textStream) {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }

      const usage = await result.usage;
      const { costToman } = await this.pricing.calcCost(
        usage.inputTokens ?? 0,
        usage.outputTokens ?? 0,
        modelId,
      );
      const chargedToman = await this.decrementStoreCredit(storeId, costToman);
      await this.prisma.creditUsageEvent.create({
        data: {
          storeId,
          model: modelId,
          kind: 'GUIDE_ASSISTANT',
          costToman,
          chargedToman,
          isFreeQuota: false,
        },
      });

      res.write('data: [DONE]\n\n');
    } catch (err) {
      if (!abortController.signal.aborted) {
        this.logger.error(
          `guide-assistant stream failed (store=${storeId}, model=${modelId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        res.write(`data: ${JSON.stringify({ error: fa.chat.streamError })}\n\n`);
      }
    } finally {
      res.end();
    }
  }

  // docs/PRD-seller-guide-assistant-modal.md بخش ۳.۳/۳.۴ — پخش فقط با کلیک دستی فروشنده روی یک
  // حباب پاسخ؛ همون زیرساخت TTS چت خریدار (KieProviderService + مدل ثابت)، ولی اینجا چون
  // تعامل روی یک کلیک مودال سینک است (نه صف/وبهوک مکالمه‌ی خریدار)، پولینگ همین‌جا inline
  // اجرا و منتظر می‌ماند تا بافر نهایی آماده شود (۳.۱: زیرساخت موجود، بدون مدل جدا)
  async synthesizeSpeech(
    sellerId: string,
    storeId: string,
    dto: GuideAssistantTtsDto,
  ): Promise<Buffer> {
    const store = await this.storeService.getOwned(sellerId, storeId);
    if (!this.hasUsableCredit(store)) {
      throw new BadRequestException(fa.store.insufficientCreditForGuideAssistant);
    }

    const { taskId } = await this.kie.createTask(TTS_MODEL_SLUG, {
      speakers: [{ speaker_id: 'Speaker 1', voice: NEUTRAL_VOICE }],
      dialogue_turns: [{ speaker_id: 'Speaker 1', text: dto.text }],
    });

    let resultUrl: string | null = null;
    let creditsConsumed: number | undefined;
    for (let attempt = 0; attempt < TTS_MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, TTS_POLL_INTERVAL_MS));
      const status = await this.kie.pollTask(taskId);
      if (status.state === 'success') {
        resultUrl = status.resultUrls[0] ?? null;
        creditsConsumed = status.creditsConsumed;
        break;
      }
      if (status.state === 'fail') {
        this.logger.error(
          `guide-assistant tts failed (store=${storeId}): ${status.failMsg ?? 'unknown'}`,
        );
        throw new BadRequestException(fa.store.guideAssistantVoiceFailed);
      }
    }
    if (!resultUrl) {
      this.logger.error(`guide-assistant tts timed out (store=${storeId})`);
      throw new BadRequestException(fa.store.guideAssistantVoiceFailed);
    }

    const wavBuffer = await this.kie.downloadResult(resultUrl);
    const mp3Buffer = await this.mediaTranscode.transcodeAudioToMp3(wavBuffer, 'wav');

    if (creditsConsumed != null) {
      const { costToman } = await this.pricing.calcFlatCostToman(
        creditsConsumed * KIE_USD_PER_CREDIT,
      );
      const chargedToman = await this.decrementStoreCredit(storeId, costToman);
      await this.prisma.creditUsageEvent.create({
        data: {
          storeId,
          model: TTS_MODEL_SLUG,
          kind: 'VOICE_TTS',
          costToman,
          chargedToman,
          isFreeQuota: false,
        },
      });
    }

    return mp3Buffer;
  }
}
