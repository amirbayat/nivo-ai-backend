import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// docs/PRD-video-edit-omni-kie.md §۳ — Kie.ai یک provider جدا و کاملاً مستقل از
// AiProviderService است (که برای providerهای چندنوعی /chat/completions-سازگار طراحی شده،
// نه قرارداد queue-based Kie). دقیقاً مثل AiProviderService.baseURL برای OpenRouter: هیچ
// fallback مستقیمی به api.kie.ai وجود ندارد — زیرساخت پروداکشن داخل ایران است، پس اتصال
// مستقیم عمداً غیرفعال است؛ باید از طریق openrouter-relay (که با KIE_TARGET_BASE_URL /
// KIE_UPLOAD_TARGET_BASE_URL چندمقصده شده — همان پروژه، بخش «چندمقصدی» در README آن) رد شود.
export class KieApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | null = null,
  ) {
    super(message);
  }
}

export type KieJobState =
  'waiting' | 'queuing' | 'generating' | 'success' | 'fail';

@Injectable()
export class KieProviderService {
  private readonly logger = new Logger(KieProviderService.name);

  constructor(private readonly config: ConfigService) {}

  get apiKey(): string {
    const key = this.config.get<string>('KIE_API_KEY');
    if (!key) throw new Error('KIE_API_KEY باید ست شود.');
    return key;
  }

  // آدرس relay برای jobs/createTask و jobs/recordInfo — هرگز مستقیم https://api.kie.ai
  get baseURL(): string {
    const url = this.config.get<string>('KIE_BASE_URL');
    if (!url) {
      throw new Error(
        'KIE_BASE_URL باید صریحاً ست شود (آدرس kie-relay خارج از ایران، مثلاً ' +
          'https://relay.nivoai.site/kie) — اتصال مستقیم به api.kie.ai از این مسیر عمداً غیرفعال است.',
      );
    }
    return url;
  }

  // آدرس relay جدا برای آپلود فایل — دامنه‌ی واقعی Kie برای این کار (kieai.redpandaai.co)
  // با api.kie.ai فرق دارد، پس یک prefix relay جدا لازم دارد (بخش ۳ سند)
  get uploadBaseURL(): string {
    const url = this.config.get<string>('KIE_UPLOAD_BASE_URL');
    if (!url) {
      throw new Error(
        'KIE_UPLOAD_BASE_URL باید صریحاً ست شود (آدرس kie-relay برای آپلود فایل، مثلاً ' +
          'https://relay.nivoai.site/kie-upload) — اتصال مستقیم عمداً غیرفعال است.',
      );
    }
    return url;
  }

  // هدر جدا از Authorization — دقیقاً همون X-Relay-Secret که OpenRouter relay هم استفاده
  // می‌کند (openrouter-relay/server.js: isAuthorized) و قبل از رسیدن به upstream حذف می‌شود
  private get relayHeaders(): Record<string, string> {
    const secret = this.config.get<string>('KIE_RELAY_SECRET');
    return secret ? { 'X-Relay-Secret': secret } : {};
  }

  private async request<T>(
    url: string,
    init: RequestInit,
    label: string,
  ): Promise<{ res: Response; json: T; text: string }> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      throw new KieApiError(
        `${label} network error: ${(err as Error).message}`,
      );
    }
    const text = await res.text();
    let json: T;
    try {
      json = JSON.parse(text) as T;
    } catch {
      throw new KieApiError(
        `${label} returned non-JSON (status=${res.status}): ${text.slice(0, 300)}`,
      );
    }
    return { res, json, text };
  }

  // آپلود فایل مرجع/منبع به فضای موقت Kie (base64) — طبق مستندات، فایل‌ها معمولاً بعد از
  // چند روز پاک می‌شوند، پس فقط برای «همین حالا submit کن» است، نه ذخیره‌سازی دائم؛ نتیجه‌ی
  // نهایی باید سریع بعد از SUCCEEDED به MinIO خودمان منتقل شود (پردازشگر صف)
  async uploadFile(buffer: Buffer, fileName: string): Promise<{ url: string }> {
    const { res, json, text } = await this.request<{
      code: number;
      msg?: string;
      data?: { downloadUrl?: string };
    }>(
      `${this.uploadBaseURL}/api/file-base64-upload`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...this.relayHeaders,
        },
        body: JSON.stringify({
          base64Data: buffer.toString('base64'),
          uploadPath: 'video-edit',
          fileName,
        }),
        signal: AbortSignal.timeout(120_000),
      },
      'Kie file-base64-upload',
    );
    if (!res.ok || json.code !== 200 || !json.data?.downloadUrl) {
      throw new KieApiError(
        `Kie file-base64-upload failed (status=${res.status}): ${json.msg ?? text.slice(0, 300)}`,
      );
    }
    return { url: json.data.downloadUrl };
  }

  // مدل‌آگنوستیک عمداً — همون یک متد برای هر مدل Kie (Omni یا هر مدل بعدی که به کاتالوگ
  // KieVideoModel اضافه شود)؛ فراخوان (video-edit.service.ts) شکل `input` را بر اساس
  // KieVideoModel.slug/capabilities می‌سازد، این‌جا فقط pass-through خام است
  async createTask(
    modelSlug: string,
    input: Record<string, unknown>,
    callbackUrl?: string,
  ): Promise<{ taskId: string }> {
    const { res, json, text } = await this.request<{
      code: number;
      msg?: string;
      data?: { taskId?: string };
    }>(
      `${this.baseURL}/api/v1/jobs/createTask`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...this.relayHeaders,
        },
        body: JSON.stringify({
          model: modelSlug,
          input,
          ...(callbackUrl ? { callBackUrl: callbackUrl } : {}),
        }),
        signal: AbortSignal.timeout(60_000),
      },
      'Kie jobs/createTask',
    );
    if (!res.ok || json.code !== 200 || !json.data?.taskId) {
      throw new KieApiError(
        `Kie jobs/createTask failed (status=${res.status}): ${json.msg ?? text.slice(0, 300)}`,
      );
    }
    return { taskId: json.data.taskId };
  }

  // نتیجه مستقیم داخل پاسخ همین پولینگ می‌آید (بخش ۲ سند — برخلاف fal، مرحله‌ی «دانلود
  // نتیجه»ی جدا لازم نیست؛ resultJson.resultUrls مستقیم و بدون Authorization قابل‌فچ است)
  async pollTask(taskId: string): Promise<{
    state: KieJobState;
    resultUrls: string[];
    creditsConsumed?: number;
    failMsg?: string | null;
  }> {
    const { res, json, text } = await this.request<{
      code: number;
      msg?: string;
      data?: {
        state?: KieJobState;
        resultJson?: string | null;
        creditsConsumed?: number;
        failMsg?: string | null;
      };
    }>(
      `${this.baseURL}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...this.relayHeaders,
        },
        signal: AbortSignal.timeout(30_000),
      },
      'Kie jobs/recordInfo',
    );
    if (!res.ok || json.code !== 200 || !json.data) {
      throw new KieApiError(
        `Kie jobs/recordInfo failed (status=${res.status}): ${json.msg ?? text.slice(0, 300)}`,
      );
    }
    let resultUrls: string[] = [];
    if (json.data.resultJson) {
      try {
        const parsed = JSON.parse(json.data.resultJson) as {
          resultUrls?: string[];
        };
        resultUrls = parsed?.resultUrls ?? [];
      } catch {
        this.logger.warn(
          `Kie recordInfo resultJson not parseable: ${json.data.resultJson}`,
        );
      }
    }
    return {
      state: json.data.state ?? 'waiting',
      resultUrls,
      creditsConsumed: json.data.creditsConsumed,
      failMsg: json.data.failMsg,
    };
  }

  // دانلود نتیجه — یک fetch ساده، بدون Authorization (تأیید‌شده با تست واقعی ۱۴۰۵/۰۶/۱۵:
  // resultUrls از دامنه‌ی موقت خودِ Kie (tempfile.aiquickdraw.com) می‌آید و مستقیم public است)
  async downloadResult(url: string): Promise<Buffer> {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      throw new KieApiError(
        `Failed to download Kie result (status=${res.status}): ${url}`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
