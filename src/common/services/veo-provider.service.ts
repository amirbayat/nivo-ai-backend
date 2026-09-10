import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { VideoProviderClient } from './video-provider-client.interface';

// Google Veo (روی Kie.ai) — endpoint اختصاصی، نه jobs/createTask عمومی (بخش ۰.۱/۳.۶ پلن).
// شکل دقیق request/response تایید‌شده مستقیم از docs.kie.ai (۱۴۰۵/۰۶/۲۰):
//   POST /api/v1/veo/generate      { prompt, imageUrls, model, generationType, aspect_ratio,
//                                     resolution, duration, callBackUrl, ... } → { taskId }
//   GET  /api/v1/veo/record-info?taskId=...  → data.successFlag (0=در حال تولید, 1=موفق,
//                                                2/3=شکست)، نتیجه در data.response.fullResultUrls
// همان baseURL/apiKey/relay-secret را با KieProviderService به اشتراک می‌گذارد چون هر دو
// زیرمسیر api.kie.ai هستند، فقط پشت همان یک relay خارج از ایران.
export class VeoApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | null = null,
  ) {
    super(message);
  }
}

@Injectable()
export class VeoProviderService implements VideoProviderClient {
  private readonly logger = new Logger(VeoProviderService.name);

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
      throw new VeoApiError(`${label} network error: ${(err as Error).message}`);
    }
    const text = await res.text();
    let json: T;
    try {
      json = JSON.parse(text) as T;
    } catch {
      throw new VeoApiError(
        `${label} returned non-JSON (status=${res.status}): ${text.slice(0, 300)}`,
      );
    }
    return { res, json, text };
  }

  // input از buildGenericKiePayload می‌آید (کلیدهای kieField همان اسم‌های وایر واقعی Veo:
  // prompt/imageUrls/generationType/aspect_ratio/resolution/duration) — این متد فقط model را
  // اضافه و POST می‌کند، هیچ نگاشت دستی فیلد اینجا نیست
  async submit(
    modelSlug: string,
    input: Record<string, unknown>,
  ): Promise<{ taskId: string }> {
    const { res, json, text } = await this.request<{
      code: number;
      msg?: string;
      data?: { taskId?: string };
    }>(
      `${this.baseURL}/api/v1/veo/generate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...this.relayHeaders,
        },
        body: JSON.stringify({ ...input, model: modelSlug }),
        signal: AbortSignal.timeout(60_000),
      },
      'Veo generate',
    );
    if (!res.ok || json.code !== 200 || !json.data?.taskId) {
      throw new VeoApiError(
        `Veo generate failed (status=${res.status}): ${json.msg ?? text.slice(0, 300)}`,
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
        successFlag?: number;
        errorMessage?: string | null;
        response?: { fullResultUrls?: string[] };
      };
    }>(
      `${this.baseURL}/api/v1/veo/record-info?taskId=${encodeURIComponent(taskId)}`,
      {
        headers: { Authorization: `Bearer ${this.apiKey}`, ...this.relayHeaders },
        signal: AbortSignal.timeout(30_000),
      },
      'Veo record-info',
    );
    if (!res.ok || json.code !== 200 || !json.data) {
      throw new VeoApiError(
        `Veo record-info failed (status=${res.status}): ${json.msg ?? text.slice(0, 300)}`,
      );
    }
    const flag = json.data.successFlag ?? 0;
    const state = flag === 1 ? 'success' : flag === 0 ? 'generating' : 'fail';
    return {
      state,
      resultUrls: json.data.response?.fullResultUrls ?? [],
      failMsg: json.data.errorMessage,
    };
  }

  async downloadResult(url: string): Promise<Buffer> {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      throw new VeoApiError(`Failed to download Veo result (status=${res.status}): ${url}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
