import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bull';
import type { BillingMode, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { KieProviderService } from '../../common/services/kie-provider.service';
import { TelegramService } from '../../modules/telegram/telegram.service';
import { toneForCategory } from '../../modules/sales-agent/tone-by-category';
import { CreditService } from '../../modules/sales-agent/credit.service';
import type { SalesAgentVoiceJobData } from '../../modules/sales-agent/sales-agent.types';

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 40; // ~۲ دقیقه سقف — TTS باید خیلی سریع‌تر از رندر ویدیو باشد
// تایید شده توسط کاربر مستقیم از kie.ai — نسخه‌ی lite (نه نسخه‌ی کامل که سند اولیه فرض کرده بود)
const DEFAULT_TTS_MODEL_SLUG = 'google/gemini-3-8-flash-lite-tts';
// صدای پیش‌فرض — تنها گزینه‌ای که با تست دستی واقعی تایید شده کار می‌کند؛ انتخاب صدای
// متفاوت بر اساس جنسیت مخاطب فیچر بعدی است (docs/PRD-sales-agent-voice.md)، فعلاً ثابت
const DEFAULT_VOICE = 'Kore';

// همان نرخ استفاده‌شده در video-edit.processor.ts (بخش ۶.۵ سند آن — ۰.۰۰۵ $ = ۱۰۰۰ credit)
const KIE_USD_PER_CREDIT = 0.005;

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
    private readonly creditService: CreditService,
  ) {}

  @Process('generate')
  async handleGenerate(job: Job<SalesAgentVoiceJobData>): Promise<void> {
    const { eventId, conversationId, text, storeCategory } = job.data;
    try {
      const conversation = await this.prisma.salesConversation.findUnique({
        where: { id: conversationId },
        select: { storeId: true, customerId: true, billingMode: true },
      });
      const key = await this.generateAndUpload(
        text,
        storeCategory,
        conversationId,
        conversation,
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
    billing: {
      storeId: string;
      customerId: string | null;
      billingMode: BillingMode;
    } | null,
  ): Promise<string> {
    const modelSlug =
      this.config.get<string>('KIE_TTS_MODEL_SLUG') ?? DEFAULT_TTS_MODEL_SLUG;
    const tone = toneForCategory(storeCategory);

    // اسکیمای واقعی این مدل با تست دستی مستقیم روی kie.ai تایید شد (۱۴۰۵/۰۷/۰۸) — فرض قبلی
    // ({text, style_prompt}) اصلاً معتبر نبود و createTask همیشه fail می‌شد (به‌خاطر همین
    // «وویس فرستاده نمی‌شد»، بی‌سروصدا، فقط در لاگ). فرمت واقعی: speakers/dialogue_turns
    // (مدل چندگوینده است)، هر speaker_id باید دقیقاً به‌شکل «Speaker N» باشد. لحن هم پارامتر
    // جدا ندارد — به‌صورت دستورالعمل طبیعی داخل متن تزریق می‌شود (الگوی مستند رسمی Gemini TTS)؛
    // فقط پذیرفته‌شدنش توسط API تایید شده، تاثیر واقعی‌اش روی صدا هنوز با گوش چک نشده
    const { taskId } = await this.kie.createTask(modelSlug, {
      speakers: [{ speaker_id: 'Speaker 1', voice: DEFAULT_VOICE }],
      dialogue_turns: [
        { speaker_id: 'Speaker 1', text: `با لحن ${tone} بگو: ${text}` },
      ],
    });

    let resultUrl: string | null = null;
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const status = await this.kie.pollTask(taskId);
      if (status.state === 'success') {
        resultUrl = status.resultUrls[0] ?? null;
        // docs/PRD-seller-credit-billing.md — هزینه‌ی واقعی وویس، از creditsConsumed واقعی kie.ai
        if (billing && status.creditsConsumed != null) {
          await this.creditService.logVoiceUsage({
            storeId: billing.storeId,
            customerId: billing.customerId,
            conversationId,
            billingMode: billing.billingMode,
            model: modelSlug,
            usdCost: status.creditsConsumed * KIE_USD_PER_CREDIT,
          });
        }
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
    // main.ts: setGlobalPrefix('api/v1') روی همه‌ی روت‌ها هست، API_URL فقط origin خالی است —
    // بدون این پیشوند تلگرام موقع دانلود فایل صوتی 404 می‌گیرد (همون باگ productImageUrl در
    // telegram.service.ts)
    const audioUrl = `${apiUrl}/api/v1/v2/chat/${conversationId}/voice/${voiceKey}`;
    await this.telegram.sendVoiceReady(chatId, audioUrl);
  }
}
