import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// این سرویس عمداً از AiProviderService استفاده نمی‌کند — baseURL/apiKey آن پشت سوییچ سراسری
// AI_PROVIDER=liara|openrouter است (که کل پلتفرم چت/عکس/video-studio را سوئیچ می‌کند، نه فقط
// این فیچر)؛ اگر پلتفرم روی liara باشد، فیچر ادیت ویدیو نباید بشکند. دقیقاً همان استقلالی که
// kie-provider.service.ts نسبت به AiProviderService دارد، اینجا هم برای OpenRouter رعایت شده —
// همان env varهای موجود (OPENROUTER_BASE_URL/API_KEY/RELAY_SECRET) مستقیم و بدون گیت خوانده می‌شوند.
export class OpenRouterVideoApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | null = null,
  ) {
    super(message);
  }
}

export type OpenRouterVideoJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

function extractErrorMessage(
  error:
    | string
    | { message?: string; code?: string | number; type?: string }
    | undefined,
  fallback: string,
): string {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.message ?? fallback;
}

@Injectable()
export class OpenRouterVideoProviderService {
  private readonly logger = new Logger(OpenRouterVideoProviderService.name);

  constructor(private readonly config: ConfigService) {}

  private get apiKey(): string {
    const key = this.config.get<string>('OPENROUTER_API_KEY');
    if (!key) throw new Error('OPENROUTER_API_KEY باید ست شود.');
    return key;
  }

  // هرگز مستقیم https://openrouter.ai — زیرساخت پروداکشن داخل ایران است، باید از
  // openrouter-relay رد شود (دقیقاً همون آدرسی که AiProviderService.baseURL برای حالت
  // openrouter استفاده می‌کند، ولی اینجا بدون گیت سوییچ سراسری خوانده می‌شود)
  private get baseURL(): string {
    const url = this.config.get<string>('OPENROUTER_BASE_URL');
    if (!url) {
      throw new Error(
        'OPENROUTER_BASE_URL باید صریحاً ست شود (آدرس openrouter-relay خارج از ایران) — ' +
          'اتصال مستقیم به openrouter.ai از این طریق عمداً غیرفعال است.',
      );
    }
    return url;
  }

  private get extraHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const siteUrl = this.config.get<string>('OPENROUTER_SITE_URL');
    const appName = this.config.get<string>('OPENROUTER_APP_NAME');
    const relaySecret = this.config.get<string>('OPENROUTER_RELAY_SECRET');
    if (siteUrl) headers['HTTP-Referer'] = siteUrl;
    if (appName) headers['X-Title'] = appName;
    if (relaySecret) headers['X-Relay-Secret'] = relaySecret;
    return headers;
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
      throw new OpenRouterVideoApiError(
        `${label} network error: ${(err as Error).message}`,
      );
    }
    const text = await res.text();
    let json: T;
    try {
      json = JSON.parse(text) as T;
    } catch {
      throw new OpenRouterVideoApiError(
        `${label} returned non-JSON (status=${res.status}): ${text.slice(0, 300)}`,
      );
    }
    return { res, json, text };
  }

  // مدل‌آگنوستیک — همون یک متد برای هر ۵ مدل تایید‌شده (Seedance 2.x / Hailuo H3)؛ فراخوان
  // (video-edit.processor.ts) شکل `input` (prompt/duration/resolution/input_references و ...)
  // را می‌سازد، این‌جا فقط pass-through خام به POST /videos است
  async createVideoJob(
    modelSlug: string,
    input: Record<string, unknown>,
  ): Promise<{ id: string }> {
    const { res, json, text } = await this.request<{
      id?: string;
      error?: string | { message?: string; code?: string | number; type?: string };
    }>(
      `${this.baseURL}/videos`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...this.extraHeaders,
        },
        body: JSON.stringify({ model: modelSlug, ...input }),
        signal: AbortSignal.timeout(60_000),
      },
      'OpenRouter /videos submit',
    );
    if (!res.ok || json.error || !json.id) {
      const message = extractErrorMessage(json.error, text.slice(0, 300));
      throw new OpenRouterVideoApiError(
        `OpenRouter /videos submit failed (status=${res.status}): ${message}`,
      );
    }
    return { id: json.id };
  }

  async pollVideoJob(id: string): Promise<{
    status: OpenRouterVideoJobStatus;
    resultUrl?: string;
    realCostUsd?: number;
    errorMessage?: string;
  }> {
    const { res, json, text } = await this.request<{
      status?: OpenRouterVideoJobStatus;
      unsigned_urls?: string[];
      error?: string | { message?: string; code?: string | number; type?: string };
      usage?: { cost?: number };
    }>(
      `${this.baseURL}/videos/${id}`,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
        },
        signal: AbortSignal.timeout(30_000),
      },
      `OpenRouter /videos/${id} poll`,
    );
    if (!res.ok) {
      const message = extractErrorMessage(json.error, text.slice(0, 300));
      throw new OpenRouterVideoApiError(
        `OpenRouter /videos/${id} poll failed (status=${res.status}): ${message}`,
      );
    }
    return {
      status: json.status ?? 'processing',
      resultUrl: json.unsigned_urls?.[0],
      realCostUsd: json.usage?.cost,
      errorMessage: json.error
        ? extractErrorMessage(json.error, undefined as never)
        : undefined,
    };
  }

  // unsigned_urls برخلاف اسمش لینک امضاشده‌ی مستقیم نیست — endpoint داخلی خودِ OpenRouter است و
  // برای دانلود هم Authorization لازم دارد (تایید‌شده در video-generation.service.ts، همون
  // مستندات رسمی video-generation برای فیچر video-studio)
  async downloadVideoResult(id: string): Promise<Buffer> {
    const url = `${this.baseURL}/videos/${id}/content?index=0`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...this.extraHeaders,
      },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      throw new OpenRouterVideoApiError(
        `Failed to download OpenRouter video result (status=${res.status}): ${url}`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
