import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { VideoProviderClient } from './video-provider-client.interface';

// Runway (روی Kie.ai) — endpoint اختصاصی، نه jobs/createTask عمومی (بخش ۰.۱/۳.۶ پلن). این
// پیاده‌سازی فقط محصول استاندارد «Runway AI Video» را پوشش می‌دهد (تایید‌شده مستقیم از
// docs.kie.ai ۱۴۰۵/۰۶/۲۰):
//   POST /api/v1/runway/generate        { prompt, imageUrl, duration, quality, aspectRatio,
//                                          waterMark, callBackUrl } → { taskId }
//   GET  /api/v1/runway/record-detail?taskId=...  → data.state (wait/queueing/generating/
//                                          success/fail)، نتیجه در data.videoInfo.videoUrl
// محصول دوم («Runway Aleph» — ادیت ویدیو به ویدیو، endpoint جدا /runway/generate-aleph طبق
// sitemap docs.kie.ai) عمداً اینجا پیاده نشده — شکل دقیق فیلدهایش هنوز تایید نشده؛ باید قبل
// از seed کردن آن ردیف کاتالوگ (گام ۴) با یک fetch مستقیم از docs.kie.ai تایید و به این
// سرویس اضافه شود (یک متد submitAleph/pollAleph جدا، نه دست‌کاری متدهای زیر).
export class RunwayApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | null = null,
  ) {
    super(message);
  }
}

@Injectable()
export class RunwayProviderService implements VideoProviderClient {
  private readonly logger = new Logger(RunwayProviderService.name);

  constructor(private readonly config: ConfigService) {}

  private get apiKey(): string {
    const key = this.config.get<string>('KIE_API_KEY');
    if (!key) throw new Error('KIE_API_KEY باید ست شود.');
    return key;
  }

  private get baseURL(): string {
    const url = this.config.get<string>('KIE_BASE_URL');
    if (!url) {
      throw new Error(
        'KIE_BASE_URL باید صریحاً ست شود (آدرس kie-relay خارج از ایران) — ' +
          'اتصال مستقیم به api.kie.ai از این مسیر عمداً غیرفعال است.',
      );
    }
    return url;
  }

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
      throw new RunwayApiError(`${label} network error: ${(err as Error).message}`);
    }
    const text = await res.text();
    let json: T;
    try {
      json = JSON.parse(text) as T;
    } catch {
      throw new RunwayApiError(
        `${label} returned non-JSON (status=${res.status}): ${text.slice(0, 300)}`,
      );
    }
    return { res, json, text };
  }

  // modelSlug اینجا استفاده نمی‌شود — Runway (برخلاف Veo) یک endpoint واحد دارد، نه یک فیلد
  // model چندگزینه‌ای؛ پارامتر فقط برای هم‌شکلی با VideoProviderClient نگه داشته شده
  async submit(
    _modelSlug: string,
    input: Record<string, unknown>,
  ): Promise<{ taskId: string }> {
    const { res, json, text } = await this.request<{
      code: number;
      msg?: string;
      data?: { taskId?: string };
    }>(
      `${this.baseURL}/api/v1/runway/generate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...this.relayHeaders,
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(60_000),
      },
      'Runway generate',
    );
    if (!res.ok || json.code !== 200 || !json.data?.taskId) {
      throw new RunwayApiError(
        `Runway generate failed (status=${res.status}): ${json.msg ?? text.slice(0, 300)}`,
      );
    }
    return { taskId: json.data.taskId };
  }

  async poll(taskId: string): Promise<{
    state: 'waiting' | 'queuing' | 'generating' | 'success' | 'fail';
    resultUrls: string[];
    failMsg?: string | null;
  }> {
    const { res, json, text } = await this.request<{
      code: number;
      msg?: string;
      data?: {
        state?: 'wait' | 'queueing' | 'generating' | 'success' | 'fail';
        failMsg?: string | null;
        videoInfo?: { videoUrl?: string };
      };
    }>(
      `${this.baseURL}/api/v1/runway/record-detail?taskId=${encodeURIComponent(taskId)}`,
      {
        headers: { Authorization: `Bearer ${this.apiKey}`, ...this.relayHeaders },
        signal: AbortSignal.timeout(30_000),
      },
      'Runway record-detail',
    );
    if (!res.ok || json.code !== 200 || !json.data) {
      throw new RunwayApiError(
        `Runway record-detail failed (status=${res.status}): ${json.msg ?? text.slice(0, 300)}`,
      );
    }
    // نگاشت اسم state خام Runway (wait/queueing) به قرارداد مشترک VideoProviderState
    // (waiting/queuing) — همون قراردادی که KieProviderService.pollTask هم برمی‌گرداند
    const rawState = json.data.state ?? 'wait';
    const state =
      rawState === 'wait' ? 'waiting' : rawState === 'queueing' ? 'queuing' : rawState;
    const url = json.data.videoInfo?.videoUrl;
    return {
      state,
      resultUrls: url ? [url] : [],
      failMsg: json.data.failMsg,
    };
  }

  async downloadResult(url: string): Promise<Buffer> {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      throw new RunwayApiError(`Failed to download Runway result (status=${res.status}): ${url}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
