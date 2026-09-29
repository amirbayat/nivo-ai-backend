import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bull';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { KieProviderService } from '../../common/services/kie-provider.service';
import { TelegramService } from '../../modules/telegram/telegram.service';
import { toneForCategory } from '../../modules/sales-agent/tone-by-category';
import type { SalesAgentVoiceJobData } from '../../modules/sales-agent/sales-agent.types';

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 40; // ~۲ دقیقه سقف — TTS باید خیلی سریع‌تر از رندر ویدیو باشد
// تایید شده توسط کاربر مستقیم از kie.ai — نسخه‌ی lite (نه نسخه‌ی کامل که سند اولیه فرض کرده بود)
const DEFAULT_TTS_MODEL_SLUG = 'google/gemini-3-8-flash-lite-tts';

// docs/PRD-sales-agent-voice.md بخش ۱.۲ — همان الگوی job-based کیو ویدیو (video-edit.processor.ts)
// روی همان KieProviderService، فقط مدل/payload فرق دارد. نتیجه روی همان ConversationEvent
// (نه یک event جدا) با آپدیت payload.voiceKey نوشته می‌شود.
@Processor('sales-agent-voice')
export class SalesAgentVoiceProcessor {
  private readonly logger = new Logger(SalesAgentVoiceProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly kie: KieProviderService,
    private readonly config: ConfigService,
    private readonly telegram: TelegramService,
  ) {}

  @Process('generate')
  async handleGenerate(job: Job<SalesAgentVoiceJobData>): Promise<void> {
    const { eventId, conversationId, text, storeCategory } = job.data;
    try {
      const key = await this.generateAndUpload(
        text,
        storeCategory,
        conversationId,
      );
      await this.finishEvent(eventId, key);
      await this.pushToTelegramIfNeeded(conversationId, key);
    } catch (err) {
      this.logger.error(
        `voice generation failed for event=${eventId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.finishEvent(eventId, null);
    }
  }

  private async generateAndUpload(
    text: string,
    storeCategory: string | null,
    conversationId: string,
  ): Promise<string> {
    const modelSlug =
      this.config.get<string>('KIE_TTS_MODEL_SLUG') ?? DEFAULT_TTS_MODEL_SLUG;
    const tone = toneForCategory(storeCategory);

    // ⚠️ اسلاگ مدل تایید شده، ولی شکل دقیق ورودی (اسم فیلدها) هنوز تایید نشده — این فقط
    // ساده‌ترین فرض منطقی روی الگوی مدل‌های TTS مشابه است؛ اولین اجرای واقعی را با یک لاگ/تست
    // دستی روی یک taskId واقعی چک کنید، اگر فیلدها فرق داشت فقط همین یک شیء عوض می‌شود
    const { taskId } = await this.kie.createTask(modelSlug, {
      text,
      style_prompt: `با لحن ${tone} بخون`,
    });

    let resultUrl: string | null = null;
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const status = await this.kie.pollTask(taskId);
      if (status.state === 'success') {
        resultUrl = status.resultUrls[0] ?? null;
        break;
      }
      if (status.state === 'fail') {
        throw new Error(`kie tts task failed: ${status.failMsg ?? 'unknown'}`);
      }
    }
    if (!resultUrl) throw new Error('kie tts task timed out');

    const buffer = await this.kie.downloadResult(resultUrl);
    return this.storage.uploadImage(buffer, 'mp3', conversationId);
  }

  private async finishEvent(
    eventId: string,
    voiceKey: string | null,
  ): Promise<void> {
    const event = await this.prisma.conversationEvent.findUnique({
      where: { id: eventId },
    });
    if (!event) return;
    const { voicePending, ...rest } = event.payload as Prisma.InputJsonObject;
    void voicePending;
    const payload: Prisma.InputJsonObject = voiceKey
      ? { ...rest, voiceKey }
      : { ...rest };
    await this.prisma.conversationEvent.update({
      where: { id: eventId },
      data: { payload },
    });
  }

  // تلگرام برخلاف وب پول‌کردن ندارد (وبهوک push-based است) — همین لحظه که وویس آماده شد
  // مستقیم برای chat_id فرستاده می‌شود، طبق بخش ۱.۵ سند
  private async pushToTelegramIfNeeded(
    conversationId: string,
    voiceKey: string,
  ): Promise<void> {
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
      include: { customer: true },
    });
    if (conversation?.customer.channel !== 'TELEGRAM') return;
    const chatId = conversation.customer.telegramChatId;
    if (!chatId) return;

    const apiUrl = this.config.get<string>('API_URL');
    const audioUrl = `${apiUrl}/v2/chat/${conversationId}/voice/${voiceKey}`;
    await this.telegram.sendVoiceReady(chatId, audioUrl);
  }
}
