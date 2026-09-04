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
// - فیلد error یک رشته‌ی ساده است، نه آبجکت {message}.
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

    const res = await (this.aiProvider.fetch ?? fetch)(
      `${this.aiProvider.baseURL}/videos`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          'Content-Type': 'application/json',
          ...(this.aiProvider.extraHeaders ?? {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      },
    );

    const text = await res.text();
    let json: { id?: string; error?: string };
    try {
      json = JSON.parse(text);
    } catch {
      throw new VideoApiError(
        `OpenRouter /videos returned non-JSON response: ${text.slice(0, 300)}`,
        null,
      );
    }
    if (!res.ok || json.error || !json.id) {
      throw new VideoApiError(json.error ?? text.slice(0, 300), null);
    }
    return { jobId: json.id };
  }

  async pollVideoJob(
    jobId: string,
    apiKey: string,
  ): Promise<{ status: VideoJobStatus; videoUrl?: string; error?: string }> {
    const res = await (this.aiProvider.fetch ?? fetch)(
      `${this.aiProvider.baseURL}/videos/${jobId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(this.aiProvider.extraHeaders ?? {}),
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    const text = await res.text();
    let json: {
      status?: VideoJobStatus;
      unsigned_urls?: string[];
      error?: string;
    };
    try {
      json = JSON.parse(text);
    } catch {
      throw new VideoApiError(
        `OpenRouter /videos/${jobId} returned non-JSON response: ${text.slice(0, 300)}`,
        null,
      );
    }
    if (!res.ok) {
      throw new VideoApiError(json.error ?? text.slice(0, 300), null);
    }
    return {
      status: json.status ?? 'processing',
      videoUrl: json.unsigned_urls?.[0],
      error: json.error,
    };
  }

  async downloadVideo(url: string): Promise<Buffer> {
    const res = await (this.aiProvider.fetch ?? fetch)(url, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok)
      throw new Error(`Failed to download generated video: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
