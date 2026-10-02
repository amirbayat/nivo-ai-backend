import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bull';
import type { BillingMode, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { KieProviderService } from '../../common/services/kie-provider.service';
import { MediaTranscodeService } from '../../common/services/media-transcode.service';
import { TelegramService } from '../../modules/telegram/telegram.service';
import { toneForCategory } from '../../modules/sales-agent/tone-by-category';
import { voiceForBuyer } from '../../modules/sales-agent/voice-gender';
import { CreditService } from '../../modules/sales-agent/credit.service';
import { buildSalesAgentVoiceWebhookCallbackUrl } from '../../modules/sales-agent/sales-agent-voice-webhook.constants';
import type { SalesAgentVoiceJobData } from '../../modules/sales-agent/sales-agent.types';

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 40; // ~۲ دقیقه سقف — TTS باید خیلی سریع‌تر از رندر ویدیو باشد
// تایید شده توسط کاربر مستقیم از kie.ai — نسخه‌ی lite (نه نسخه‌ی کامل که سند اولیه فرض کرده بود)
const DEFAULT_TTS_MODEL_SLUG = 'google/gemini-3-8-flash-lite-tts';

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
    private readonly mediaTranscode: MediaTranscodeService,
  ) {}

  @Process('generate')
  async handleGenerate(job: Job<SalesAgentVoiceJobData>): Promise<void> {
    const { eventId, conversationId, text, storeCategory, traceEventId } =
      job.data;
    try {
      const conversation = await this.loadBillingConversation(conversationId);
      // docs/PRD-sales-agent-voice.md بخش ۶.۴ — تخمین جنسیت خریدار از اسم تلگرام (اگر در
      // دسترس بود) و انتخاب صدای مخالف آن؛ وقتی اسم نیست/ناشناس است، صدای خنثی پیش‌فرض
      const voice = voiceForBuyer(conversation?.customer.fullName);
      const { key, toneVariant } = await this.generateAndUpload(
        eventId,
        traceEventId,
        text,
        storeCategory,
        conversationId,
        conversation,
        voice,
      );
      this.logger.log(
        `voice generation succeeded for event=${eventId} conversation=${conversationId} channel=${conversation?.customer.channel ?? 'unknown'}`,
      );
      await this.finishEvent(eventId, key, traceEventId, toneVariant, voice);
      await this.pushToTelegramIfNeeded(conversationId, key);
    } catch (err) {
      // فیدبک کاربر ۱۴۰۵/۰۷/۰۱ — قبلاً اینجا همیشه خطا را می‌بلعید (catch بدون throw دوباره)،
      // یعنی Bull همیشه job را «موفق» می‌دید و هیچ‌وقت retry نمی‌زد، حتی با attempts:2 تنظیم‌شده
      // روی voiceQueue.add (conversation-engine.service.ts). اگر هنوز تلاش باقی مانده، باید
      // دوباره throw بشه تا Bull خودش retry کند؛ finishEvent(..., null, ...) فقط روی آخرین
      // تلاش صدا زده می‌شود، وگرنه trace زودتر از موعد «ناموفق» نهایی می‌شد و پولینگ درِاور
      // ادمین (A5) قبل از نتیجه‌ی واقعی retry متوقف می‌شد
      const maxAttempts = job.opts?.attempts ?? 1;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
      this.logger.error(
        `voice generation failed for event=${eventId} (attempt ${job.attemptsMade + 1}/${maxAttempts}): ${err instanceof Error ? err.message : String(err)}`,
      );
      if (!isFinalAttempt) throw err;
      await this.finishEvent(eventId, null, traceEventId);
    }
  }

  // فیدبک کاربر ۱۴۰۵/۰۷/۰۱ — بعد از اینکه polling معمولی (handleGenerate بالا) تایم‌اوت زد و
  // event را FAILED نهایی کرد، webhook می‌تواند با همین taskId یک بار دیگر pollTask بزند تا
  // ببیند آیا Kie دیرتر واقعاً موفق شده یا نه — همون الگوی video-edit-webhook.service.ts،
  // فقط به‌جای اعتماد به بدنه‌ی webhook (که شکلش برای endpoint عمومی jobs/createTask مستند
  // نیست)، از همون pollTask قابل‌اعتماد موجود استفاده می‌کند. فراخوانی از
  // SalesAgentVoiceWebhookService، بعد از اینکه آنجا تایید شده event واقعاً FAILED نهایی شده
  // (نه هنوز در حال polling فعال) — صدا زدن این متد وقتی poll loop فعاله یعنی ریسک کسر دوباره
  async recoverFromWebhook(
    eventId: string,
    conversationId: string,
    taskId: string,
    traceEventId?: string,
  ): Promise<void> {
    try {
      const status = await this.kie.pollTask(taskId);
      if (status.state !== 'success') {
        this.logger.log(
          `sales-agent-voice webhook recovery: event=${eventId} taskId=${taskId} هنوز state=${status.state} — no-op`,
        );
        return;
      }
      const resultUrl = status.resultUrls[0] ?? null;
      if (!resultUrl) {
        this.logger.warn(
          `sales-agent-voice webhook recovery: event=${eventId} taskId=${taskId} state=success ولی resultUrl ندارد`,
        );
        return;
      }

      // چک مجدد درست قبل از نوشتن — پنجره‌ی کوچک race در صورت رسیدن دوباره‌ی همین webhook را
      // کم می‌کند (قفل اتمیک کامل برای این مسیر کم‌ریسک/کم‌ارزش overkill است)
      const fresh = await this.prisma.conversationEvent.findUnique({
        where: { id: eventId },
      });
      const freshPayload = fresh?.payload as { voiceKey?: string } | null;
      if (freshPayload?.voiceKey) {
        this.logger.log(
          `sales-agent-voice webhook recovery: event=${eventId} همین الان توسط یک فراخوانی موازی بازیابی شد — no-op`,
        );
        return;
      }

      const conversation = await this.loadBillingConversation(conversationId);
      const voice = voiceForBuyer(conversation?.customer.fullName);
      const modelSlug =
        this.config.get<string>('KIE_TTS_MODEL_SLUG') ?? DEFAULT_TTS_MODEL_SLUG;
      if (conversation && status.creditsConsumed != null) {
        await this.creditService.logVoiceUsage({
          storeId: conversation.storeId,
          customerId: conversation.customerId,
          conversationId,
          billingMode: conversation.billingMode,
          model: modelSlug,
          usdCost: status.creditsConsumed * KIE_USD_PER_CREDIT,
        });
      }
      const tone = toneForCategory(conversation?.store.category ?? null);
      const key = await this.downloadAndStore(resultUrl, conversationId);
      await this.finishEvent(eventId, key, traceEventId, tone, voice);
      await this.pushToTelegramIfNeeded(conversationId, key);
      this.logger.log(
        `sales-agent-voice webhook recovery: event=${eventId} بعد از تایم‌اوت polling با webhook بازیابی و SUCCEEDED شد`,
      );
    } catch (err) {
      this.logger.error(
        `sales-agent-voice webhook recovery failed for event=${eventId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      // چیزی برای برگرداندن نیست — event همین الان هم FAILED نهایی شده بود
    }
  }

  private async loadBillingConversation(conversationId: string) {
    return this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
      select: {
        storeId: true,
        customerId: true,
        billingMode: true,
        customer: {
          select: { fullName: true, channel: true, telegramChatId: true },
        },
        store: { select: { category: true } },
      },
    });
  }

  private async downloadAndStore(
    resultUrl: string,
    conversationId: string,
  ): Promise<string> {
    const buffer = await this.kie.downloadResult(resultUrl);
    // فیدبک کاربر ۱۴۰۵/۰۷/۱۲ — خروجی واقعی Kie یک فایل WAV است (resultUrl خودش با .wav تمام
    // می‌شود). قبلاً اینجا بدون ترنسکود مستقیم WAV ذخیره می‌شد، به این فرض که «تلگرام خودش
    // فایل را دوباره پردازش می‌کند، فرقی نمی‌کند» — این فرض با خطای زنده‌ی تلگرام رد شد:
    // sendAudio با وجود دانلود موفق HTTP (تست دستی با curl روی پروداکشن: ۲۰۰، فایل WAV سالم)
    // با «Bad Request: failed to get HTTP URL content» رد می‌شد، چون طبق مستندات خودِ تلگرام
    // sendAudio فقط MP3/M4A واقعی را می‌پذیرد. اینجا با ffmpeg (media-transcode worker، همون
    // زیرساخت ویدیو) به MP3 تبدیل می‌شود — برخلاف extractAudio (مخصوص ASR، افت کیفیت عمدی)،
    // نرخ نمونه‌ی منبع دست‌نخورده می‌ماند.
    const mp3Buffer = await this.mediaTranscode.transcodeAudioToMp3(
      buffer,
      'wav',
    );
    return this.storage.uploadImage(mp3Buffer, 'mp3', conversationId);
  }

  // فیدبک کاربر ۱۴۰۵/۰۷/۰۱ — kieTaskId روی payload خودِ event نوشته می‌شود تا webhook بتواند
  // بعداً با همین taskId مسیرش را به همین event پیدا کند (recoverFromWebhook بالا)
  private async persistTaskTracking(
    eventId: string,
    taskId: string,
    traceEventId?: string,
  ): Promise<void> {
    const event = await this.prisma.conversationEvent.findUnique({
      where: { id: eventId },
    });
    if (!event) return;
    const payload = event.payload as Prisma.InputJsonObject;
    await this.prisma.conversationEvent.update({
      where: { id: eventId },
      data: {
        payload: {
          ...payload,
          kieTaskId: taskId,
          ...(traceEventId ? { voiceTraceEventId: traceEventId } : {}),
        },
      },
    });
  }

  private async generateAndUpload(
    eventId: string,
    traceEventId: string | undefined,
    text: string,
    storeCategory: string | null,
    conversationId: string,
    billing: {
      storeId: string;
      customerId: string | null;
      billingMode: BillingMode;
      customer: { telegramChatId: string | null };
    } | null,
    voice: string,
  ): Promise<{ key: string; toneVariant: string }> {
    const modelSlug =
      this.config.get<string>('KIE_TTS_MODEL_SLUG') ?? DEFAULT_TTS_MODEL_SLUG;
    const tone = toneForCategory(storeCategory);

    // اسکیمای واقعی این مدل با تست دستی مستقیم روی kie.ai تایید شد (۱۴۰۵/۰۷/۰۸) — فرض قبلی
    // ({text, style_prompt}) اصلاً معتبر نبود و createTask همیشه fail می‌شد (به‌خاطر همین
    // «وویس فرستاده نمی‌شد»، بی‌سروصدا، فقط در لاگ). فرمت واقعی: speakers/dialogue_turns
    // (مدل چندگوینده است)، هر speaker_id باید دقیقاً به‌شکل «Speaker N» باشد.
    //
    // فیدبک کاربر ۱۴۰۵/۰۷/۰۱: دستورالعمل لحن («با لحن ... بگو:») عیناً توی صدای تولیدشده
    // خونده می‌شد — چون این مدل پارامتر style جدا ندارد و قبلاً به‌عنوان دستورالعمل طبیعی
    // داخل متن تزریق می‌شد، که این مدل بر خلاف فرض قبلی آن را خطاب به شنونده می‌خواند، نه یک
    // دستور اجرایی. تا پارامتر style واقعی/انتخاب speaker جدا بررسی شود، فقط متن خام فرستاده
    // می‌شود؛ `tone` هنوز محاسبه و به‌عنوان متادیتای نمایشی (toneVariant) برگردانده می‌شود.
    //
    // callbackUrl: فقط اگر API_URL ست باشد (همون الگوی video-edit.processor.ts's
    // kieWebhookCallbackUrl) — polling همیشه فعال می‌ماند، webhook فقط یک safety-net اضافه
    // برای بعد از تایم‌اوت است (recoverFromWebhook بالا)
    const apiUrl = this.config.get<string>('API_URL');
    const callbackUrl = apiUrl
      ? buildSalesAgentVoiceWebhookCallbackUrl(apiUrl)
      : undefined;
    const { taskId } = await this.kie.createTask(
      modelSlug,
      {
        speakers: [{ speaker_id: 'Speaker 1', voice }],
        dialogue_turns: [{ speaker_id: 'Speaker 1', text }],
      },
      callbackUrl,
    );
    await this.persistTaskTracking(eventId, taskId, traceEventId);

    // فیدبک کاربر ۱۴۰۵/۰۷/۱۲ — تا این مرحله (می‌تواند تا ~۲ دقیقه طول بکشد) مشتری تلگرامی
    // هیچ نشانه‌ای نمی‌بیند؛ sendChatAction فقط ~۵ ثانیه نمایش داده می‌شود، پس باید هر چند
    // ثانیه تکرار شود تا پاسخ واقعی برسد — هر تلاش پولینگ (هر ۳ ثانیه) یک بار کافی است
    const telegramChatId = billing?.customer.telegramChatId;
    if (telegramChatId) {
      await this.telegram.sendRecordingVoiceAction(telegramChatId);
    }

    let resultUrl: string | null = null;
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (telegramChatId) {
        await this.telegram.sendRecordingVoiceAction(telegramChatId);
      }
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

    const key = await this.downloadAndStore(resultUrl, conversationId);
    return { key, toneVariant: tone };
  }

  private async finishEvent(
    eventId: string,
    voiceKey: string | null,
    traceEventId?: string,
    toneVariant?: string,
    voiceName?: string,
  ): Promise<void> {
    const event = await this.prisma.conversationEvent.findUnique({
      where: { id: eventId },
    });
    if (event) {
      const { voicePending, voice, ...rest } =
        event.payload as Prisma.InputJsonObject & {
          voice?: Prisma.InputJsonObject;
        };
      void voicePending;
      void voice;
      // فیدبک کاربر ۱۴۰۵/۰۷/۱۲ — قبلاً وقتی تولید شکست می‌خورد، این فیلد را اصلاً لمس نمی‌کرد
      // و voice:{generated:true} که logReply اولیه نوشته بود برای همیشه همین‌طور گمراه‌کننده
      // می‌ماند؛ حالا همیشه با نتیجه‌ی واقعی نهایی می‌شود (مثل بخش trace پایین)
      const finalVoice: Prisma.InputJsonObject = voiceKey
        ? {
            generated: true,
            voiceName: voiceName ?? '',
            toneVariant: toneVariant ?? '',
          }
        : { generated: false, reason: 'FAILED' };
      const payload: Prisma.InputJsonObject = voiceKey
        ? { ...rest, voiceKey, voice: finalVoice }
        : { ...rest, voice: finalVoice };
      await this.prisma.conversationEvent.update({
        where: { id: eventId },
        data: { payload },
      });
    }

    // docs/PRD-admin-ai-decision-trace-log.md بخش ۲ — تصمیم وویس دیرتر از پاسخ متنی معلوم
    // می‌شود، پس بخش voice همان AI_TRACE اینجا (نه در logReply) نهایی می‌شود
    if (!traceEventId) return;
    const traceEvent = await this.prisma.conversationEvent.findUnique({
      where: { id: traceEventId },
    });
    if (!traceEvent) return;
    const trace = traceEvent.payload as Prisma.InputJsonObject;
    const voice: Prisma.InputJsonObject = voiceKey
      ? {
          generated: true,
          voiceName: voiceName ?? '',
          toneVariant: toneVariant ?? '',
        }
      : { generated: false, reason: 'FAILED' };
    await this.prisma.conversationEvent.update({
      where: { id: traceEventId },
      data: { payload: { ...trace, voice } },
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
    if (conversation?.customer.channel !== 'TELEGRAM') {
      // فیدبک کاربر ۱۴۰۵/۰۷/۱۲ — این برنچ قبلاً کاملاً بی‌صدا بود (return خالی)؛ برای
      // مکالمه‌های وب طبیعی است (هیچ وقت صدا زده نمی‌شود چون پول‌کردن سمت وب جداست)، ولی اگر
      // یک مکالمه‌ی تلگرامی به‌هر دلیلی channel اشتباه داشته باشد همین‌جا معلوم می‌شود
      this.logger.debug(
        `voice ready for conversation=${conversationId} but channel=${conversation?.customer.channel ?? 'unknown'} (not TELEGRAM) — skip push`,
      );
      return;
    }
    const chatId = conversation.customer.telegramChatId;
    if (!chatId) {
      this.logger.warn(
        `voice ready for TELEGRAM conversation=${conversationId} but customer has no telegramChatId — cannot push`,
      );
      return;
    }

    const apiUrl = this.config.get<string>('API_URL');
    // main.ts: setGlobalPrefix('api/v1') روی همه‌ی روت‌ها هست، API_URL فقط origin خالی است —
    // بدون این پیشوند تلگرام موقع دانلود فایل صوتی 404 می‌گیرد (همون باگ productImageUrl در
    // telegram.service.ts). voiceKey هم شامل پیشوند «conversationId/» است (storage.service.ts
    // uploadImage) — باید encode شود وگرنه «/» داخلش روت :key را به چند سگمنت می‌شکند و سرور
    // تلگرام موقع دانلود 404 می‌گیرد
    const audioUrl = `${apiUrl}/api/v1/v2/chat/${conversationId}/voice/${encodeURIComponent(voiceKey)}`;
    await this.telegram.sendVoiceReady(chatId, audioUrl);
    this.logger.log(
      `voice pushed to telegram chatId=${chatId} conversation=${conversationId}`,
    );
  }
}
