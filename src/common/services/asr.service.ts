import { Injectable, Logger } from '@nestjs/common';
import { AiProviderService } from './ai-provider.service';

// خطای «در دسترس نبودن» — فقط این نوع خطا باعث می‌شود transcribeWithFallback سراغ مدل بعدی
// برود (۴۲۹/۵xx/شبکه/timeout). خطای دیگر (مثلاً ۴۰۰ به‌خاطر فایل صوتی خراب) با مدل بعدی هم
// دوباره رخ می‌دهد، پس باید مستقیم پرت شود، نه fallback — docs/PRD-video-auto-captions.md §۱۷.۴
//
// TODO موقت (۱۴۰۵-۰۶-۱۵): چون دو پروژه‌ی متفاوت هر دو فقط با ۴۰۰ دقیقاً روی
// whisper-large-v3-turbo شکست خوردند (نه محتوای صوتی خاص یک پروژه)، فعلاً پایین‌تر ۴۰۰ هم
// موقتاً AsrAvailabilityError می‌شود تا زنجیره‌ی fallback امتحان شود و مشخص شود مشکل مختص
// این مدل/provider (DeepInfra) است یا نه. بعد از جمع‌آوری داده‌ی کافی این رفتار را طبق §۱۷.۴
// اصلی (۴۰۰ = پرتاب مستقیم، بدون fallback) برگردان.
export class AsrAvailabilityError extends Error {}

export interface AsrWord {
  word: string;
  start: number;
  end: number;
  speaker: string | null;
}

export interface AsrTranscriptResult {
  text: string;
  words: AsrWord[];
  language: string | null;
  durationSec: number;
  costUsd: number;
  modelUsed: string;
}

interface OpenRouterTranscriptionResponse {
  text?: string;
  language?: string;
  duration?: number;
  usage?: { seconds?: number; cost?: number };
  words?: { word: string; start: number; end: number; speaker?: string | null }[];
  error?: { message?: string; code?: string | number } | string;
}

// ترتیب زنجیره‌ی fallback — تأیید شده با تست واقعی روی نمونه‌ی صوتی فارسی
// (docs/PRD-video-auto-captions.md §۱۷.۵، ۱۴۰۵-۰۶-۱۴): هر ۴ مدل واقعاً timestamp سطح کلمه
// می‌دهند. gpt-4o-transcribe/gpt-4o-mini-transcribe عمداً در این لیست نیستند — طبق مستندات
// رسمی OpenAI اصلاً timestamp_granularities را پشتیبانی نمی‌کنند (§۱۷.۱).
export const ASR_FALLBACK_CHAIN = [
  'openai/whisper-large-v3-turbo',
  'openai/whisper-large-v3',
  'openai/whisper-1',
  'x-ai/grok-stt-1.0',
] as const;

// docs/PRD-video-auto-captions.md §۴/§۱۷ — فراخوانی POST /audio/transcriptions روی OpenRouter
// (از طریق aiProvider.baseURL که در پروداکشن به openrouter-relay اشاره می‌کند، نه مستقیم
// openrouter.ai — دقیقاً همان الگوی video-generation.service.ts). چون این یک آپلود
// multipart/form-data است (نه chat completion)، از aiProvider.buildClient() استفاده نمی‌کند؛
// مستقیم با aiProvider.fetch/baseURL/sharedApiKey/extraHeaders کار می‌کند.
@Injectable()
export class AsrService {
  private readonly logger = new Logger(AsrService.name);

  constructor(private readonly aiProvider: AiProviderService) {}

  async transcribeWithFallback(
    audioBuffer: Buffer,
    apiKey: string,
    language = 'fa',
  ): Promise<AsrTranscriptResult> {
    let lastErr: Error | null = null;
    for (const model of ASR_FALLBACK_CHAIN) {
      try {
        return await this.transcribeWithModel(model, audioBuffer, apiKey, language);
      } catch (err) {
        if (!(err instanceof AsrAvailabilityError)) throw err;
        lastErr = err;
        this.logger.warn(`ASR model ${model} در دسترس نبود، رفتن به مدل بعدی: ${err.message}`);
      }
    }
    throw lastErr ?? new Error('ASR fallback chain exhausted with no error captured');
  }

  async transcribeWithModel(
    model: string,
    audioBuffer: Buffer,
    apiKey: string,
    language: string,
  ): Promise<AsrTranscriptResult> {
    // base64 در بدنه‌ی JSON، نه multipart/form-data — دقیقاً همان الگوی موجود frame_images در
    // video-generation.service.ts (data:...;base64,...)، هم برای یکدستی با بقیه‌ی کد، هم چون
    // ارسال Buffer به‌عنوان Blob/BlobPart در این نسخه‌ی TypeScript با تایپ‌های lib.dom تداخل دارد
    const body = {
      model,
      input_audio: { data: audioBuffer.toString('base64'), format: 'mp3' },
      language,
      response_format: 'verbose_json',
      timestamp_granularities: ['word'],
    };

    const url = `${this.aiProvider.baseURL}/audio/transcriptions`;

    // لاگ تشخیصی: چون بدنه‌ی خطای OpenRouter برای ۴۰۰های forward-شده از provider معمولاً
    // فقط پیام عمومی "Provider returned 400" است (بدون جزئیات واقعی)، دقیقاً چه چیزی/چطور
    // ارسال می‌شود را کامل لاگ می‌کنیم (بدون خودِ base64 صدا، آن خیلی حجیم است) تا بعداً
    // بشود حدس زد آیا مشکل مختص یک فایل خاص، فرمت request، یا مسیر relay بوده یا نه
    this.logger.log(
      `ASR ${model} request → POST ${url} | via=${this.aiProvider.fetch ? 'proxy-fetch(undici+dispatcher)' : 'global-fetch'} | ` +
        `body: model=${model} language=${language} response_format=verbose_json timestamp_granularities=[word] ` +
        `input_audio.format=mp3 audioBytes=${audioBuffer.length} (base64Len=${body.input_audio.data.length}) | ` +
        `extraHeaders=${JSON.stringify(Object.keys(this.aiProvider.extraHeaders ?? {}))}`,
    );

    let res: Response;
    try {
      res = await (this.aiProvider.fetch ?? fetch)(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(this.aiProvider.extraHeaders ?? {}),
        },
        body: JSON.stringify(body),
        // مستندات رسمی OpenRouter: provider بالادستی خودش بعد از ۶۰ ثانیه timeout می‌کند
        // (docs/PRD-video-auto-captions.md §۴.۳) — این‌جا کمی بیشتر می‌گذاریم تا زودتر از خودِ provider قطع نکنیم
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err) {
      throw new AsrAvailabilityError(`ASR ${model} network error: ${(err as Error).message}`);
    }

    const text = await res.text();
    // شناسه‌ی درخواست OpenRouter برای پیگیری بعدی با پشتیبانی‌شان (خودِ بدنه‌ی خطا چیزی
    // بیشتر از پیام عمومی ندارد، ولی این هدر ممکن است در پنل/پشتیبانی OpenRouter قابل جستجو باشد)
    const requestId = res.headers.get('x-request-id') ?? res.headers.get('cf-ray');

    if (!res.ok) {
      const detail = `status=${res.status} audioBytes=${audioBuffer.length} requestId=${requestId ?? 'n/a'}: ${text.slice(0, 300)}`;
      // TODO موقت (۱۴۰۵-۰۶-۱۵، بالای فایل): ۴۰۰ فعلاً هم fallback می‌کند تا مشخص شود مشکل
      // مختص whisper-large-v3-turbo/DeepInfra است یا نه — طبق §۱۷.۴ اصلی باید حذف شود.
      if (res.status === 429 || res.status >= 500 || res.status === 400) {
        throw new AsrAvailabilityError(`ASR ${model} unavailable (${detail})`);
      }
      throw new Error(`ASR ${model} request failed (${detail})`);
    }

    let json: OpenRouterTranscriptionResponse;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AsrAvailabilityError(`ASR ${model} returned non-JSON (status=${res.status})`);
    }

    if (json.error) {
      const message = typeof json.error === 'string' ? json.error : (json.error.message ?? text.slice(0, 300));
      throw new AsrAvailabilityError(`ASR ${model} error: ${message}`);
    }

    return {
      text: json.text ?? '',
      words: (json.words ?? []).map((w) => ({
        word: w.word,
        start: w.start,
        end: w.end,
        speaker: w.speaker ?? null,
      })),
      // whisper-1 در تست واقعی §۱۷.۵ مقدار "persian" برمی‌گرداند، نه کد ISO "fa" مثل بقیه‌ی
      // مدل‌ها — caller نباید فرض کند این فیلد همیشه یک کد ISO دو-حرفی است
      language: json.language ?? null,
      durationSec: json.duration ?? 0,
      costUsd: json.usage?.cost ?? 0,
      modelUsed: model,
    };
  }
}
