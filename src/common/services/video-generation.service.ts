import { Injectable, Logger } from '@nestjs/common';
import { AiProviderService } from './ai-provider.service';

// docs/PRD-video-studio-chat-flow.md §۸.۶ — تولید ویدیوی OpenRouter، برخلاف عکس
// (image-generation.service.ts، همیشه synchronous)، ذاتاً async است: submit یک job برمی‌گرداند،
// بعد باید دوره‌ای poll شود تا completed/failed. این سرویس فقط لایه‌ی HTTP خام است — تصمیم
// polling interval/timeout کلی و ذخیره‌سازی نتیجه در MinIO به‌عهده‌ی صف/پردازشگر بالادستی است
// (queue/processors/studio-video-generation.processor.ts).
//
// شکل request/response زیر با مستندات رسمی OpenRouter تایید شده (۱۴۰۵-۰۶-۱۴،
// https://openrouter.ai/docs/api/api-reference/video-generation/create-videos):
// - وقتی status=«completed» می‌شود، URL ویدیو در آرایه‌ی `unsigned_urls` می‌آید، نه `video.url`.
// - علاوه بر «failed»، «cancelled» و «expired» هم وضعیت پایانی (شکست) هستند.
// - فیلد error گاهی رشته‌ی ساده است، گاهی (خطاهای سطح gateway مثل ۴۰۱/۴۲۹/۵xx) آبجکت
//   استاندارد {message,type,code} شبیه OpenAI/OpenRouter chat errors — دقیقاً مثل
//   image-generation.service.ts، پس همیشه باید پیام رشته‌ای را از هر دو شکل استخراج کرد
//   (وگرنه new Error(آبجکت) پیامش را با toString پیش‌فرض به "[object Object]" تبدیل می‌کند).
function extractVideoErrorMessage(
  error: string | { message?: string; code?: string | number; type?: string } | undefined,
  fallback: string,
): string {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.message ?? fallback;
}

export class VideoApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | null,
  ) {
    super(message);
  }
}

export type VideoJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

@Injectable()
export class VideoGenerationService {
  private readonly logger = new Logger(VideoGenerationService.name);

  constructor(private readonly aiProvider: AiProviderService) {}

  // مشاهده‌شده در پروداکشن: این endpoint (هنوز نسبتاً تازه/بتا در OpenRouter) گاه‌به‌گاه
  // به‌جای گیت‌وی واقعی API، به fallback صفحه‌ی ۴۰۴ سایت مارکتینگ‌شان (HTML، نه JSON) می‌افتد
  // — به‌نظر یک miss موقتی/edge-specific است چون درخواست بلافاصله‌ی بعدی معمولاً موفق است،
  // دقیقاً مثل retry-once موجود برای شبکه/۵xx در image-generation.service.ts. `buildInit` هر بار
  // فراخوانی می‌شود تا AbortSignal.timeout هر تلاش تازه باشد (نه از تلاش قبلی مصرف‌شده).
  private async fetchOpenRouterVideo<T>(
    url: string,
    buildInit: () => RequestInit,
    label: string,
  ): Promise<{ res: Response; json: T; text: string }> {
    const doFetch = () => (this.aiProvider.fetch ?? fetch)(url, buildInit());

    let res: Response;
    try {
      res = await doFetch();
      if (!res.ok && res.status >= 500) {
        this.logger.warn(`${label} returned ${res.status}, retrying once`);
        res = await doFetch();
      }
    } catch (err) {
      this.logger.warn(
        `${label} network error, retrying once: ${(err as Error).message}`,
      );
      res = await doFetch();
    }

    let text = await res.text();
    let json: T;
    try {
      json = JSON.parse(text);
    } catch {
      this.logger.warn(
        `${label} returned non-JSON (status=${res.status}), retrying once`,
      );
      res = await doFetch();
      text = await res.text();
      try {
        json = JSON.parse(text);
      } catch {
        throw new VideoApiError(
          `${label} returned non-JSON response after retry (status=${res.status}): ${text.slice(0, 300)}`,
          null,
        );
      }
    }
    return { res, json, text };
  }

  async submitVideoJob(params: {
    modelId: string;
    prompt: string;
    apiKey: string;
    durationSec?: number;
    size?: string;
    audioEnabled?: boolean;
    referenceImage?: Buffer;
  }): Promise<{ jobId: string }> {
    const body: Record<string, unknown> = {
      model: params.modelId,
      prompt: params.prompt,
      ...(params.durationSec ? { duration: params.durationSec } : {}),
      ...(params.size ? { size: params.size } : {}),
      ...(params.audioEnabled !== undefined
        ? { generate_audio: params.audioEnabled }
        : {}),
    };
    // frame_images: [{type, image_url:{url}, frame_type}] — تایید شده با مستندات رسمی OpenRouter
    // (https://openrouter.ai/docs/guides/overview/multimodal/video-generation)؛ کاتالوگ مدل‌ها
    // (openroutermodels.json: supported_video_parameters.supported_frame_images) هم فقط همین
    // فیلد را برای مدل‌های ویدیو نشان می‌دهد، نه input_reference/input_references (که مخصوص
    // مدل‌های تصویر است). عکس preview کاراکتر به‌عنوان first_frame فرستاده می‌شود تا ظاهر
    // شخصیت در طول صحنه ثابت بماند.
    if (params.referenceImage) {
      body.frame_images = [
        {
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${params.referenceImage.toString('base64')}`,
          },
          frame_type: 'first_frame',
        },
      ];
    }

    const { res, json, text } = await this.fetchOpenRouterVideo<{
      id?: string;
      error?: string | { message?: string; code?: string | number; type?: string };
    }>(
      `${this.aiProvider.baseURL}/videos`,
      () => ({
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          'Content-Type': 'application/json',
          ...(this.aiProvider.extraHeaders ?? {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      }),
      'OpenRouter /videos submit',
    );
    if (!res.ok || json.error || !json.id) {
      const message = extractVideoErrorMessage(json.error, text.slice(0, 300));
      const code =
        typeof json.error === 'object'
          ? (json.error.code ?? json.error.type ?? null)
          : null;
      throw new VideoApiError(
        `OpenRouter /videos submit failed (status=${res.status}): ${message}`,
        code == null ? null : String(code),
      );
    }
    return { jobId: json.id };
  }

  async pollVideoJob(
    jobId: string,
    apiKey: string,
  ): Promise<{
    status: VideoJobStatus;
    videoUrl?: string;
    error?: string;
    realCostUsd?: number;
  }> {
    const { res, json, text } = await this.fetchOpenRouterVideo<{
      status?: VideoJobStatus;
      unsigned_urls?: string[];
      error?: string | { message?: string; code?: string | number; type?: string };
      // هزینه‌ی واقعی provider — دقیقاً همون فیلد usage.cost که برای چت/عکس OpenRouter
      // برمی‌گرداند (ai-provider.service.ts: OpenRouterUsage.cost)، طبق مستندات رسمی video
      // generation فقط وقتی status=completed پر می‌شود.
      usage?: { cost?: number };
    }>(
      `${this.aiProvider.baseURL}/videos/${jobId}`,
      () => ({
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(this.aiProvider.extraHeaders ?? {}),
        },
        signal: AbortSignal.timeout(30_000),
      }),
      `OpenRouter /videos/${jobId} poll`,
    );
    if (!res.ok) {
      const message = extractVideoErrorMessage(json.error, text.slice(0, 300));
      const code =
        typeof json.error === 'object'
          ? (json.error.code ?? json.error.type ?? null)
          : null;
      throw new VideoApiError(
        `OpenRouter /videos/${jobId} poll failed (status=${res.status}): ${message}`,
        code == null ? null : String(code),
      );
    }
    return {
      status: json.status ?? 'processing',
      videoUrl: json.unsigned_urls?.[0],
      error: json.error ? extractVideoErrorMessage(json.error, '') : undefined,
      realCostUsd: json.usage?.cost,
    };
  }

  // مستندات رسمی (همون صفحه‌ی §بالا، بخش «Downloading the Video»، تایید‌شده با تست مستقیم
  // امروز): برخلاف اسمش، `unsigned_urls` یک لینک CDN/S3 پیش‌امضاشده نیست — دقیقاً همون
  // endpoint داخلی OpenRouter (`/videos/{jobId}/content?index=0`) است و برای دانلودش هم باید
  // Authorization: Bearer فرستاد. پس به‌جای اعتماد به URL مطلق برگشتی از pollVideoJob (که
  // مستقیم به‌ openrouter.ai اشاره می‌کند و از relay رد نمی‌شود — دقیقاً همون اتصال مستقیمی که
  // AiProviderService.baseURL عمداً ممنوعش کرده)، خودمان از روی baseURL (relay) می‌سازیمش.
  async downloadVideo(jobId: string, apiKey: string): Promise<Buffer> {
    const url = `${this.aiProvider.baseURL}/videos/${jobId}/content?index=0`;
    const doFetch = () =>
      (this.aiProvider.fetch ?? fetch)(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(this.aiProvider.extraHeaders ?? {}),
        },
        signal: AbortSignal.timeout(120_000),
      });

    let res = await doFetch();
    if (!res.ok && res.status >= 500) {
      this.logger.warn(
        `OpenRouter /videos/${jobId}/content returned ${res.status}, retrying once`,
      );
      res = await doFetch();
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new VideoApiError(
        `Failed to download generated video (status=${res.status}): ${text.slice(0, 300)}`,
        null,
      );
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
