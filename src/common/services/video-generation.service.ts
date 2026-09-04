import { Injectable, Logger } from '@nestjs/common';
import { AiProviderService } from './ai-provider.service';

// docs/PRD-video-studio-chat-flow.md §۸.۶ — تولید ویدیوی OpenRouter، برخلاف عکس
// (image-generation.service.ts، همیشه synchronous)، ذاتاً async است: submit یک job برمی‌گرداند،
// بعد باید دوره‌ای poll شود تا completed/failed. این سرویس فقط لایه‌ی HTTP خام است — تصمیم
// polling interval/timeout کلی و ذخیره‌سازی نتیجه در MinIO به‌عهده‌ی صف/پردازشگر بالادستی است
// (queue/processors/studio-video-generation.processor.ts).
//
// ⚠️ هشدار مهم: شکل دقیق request/response زیر بر اساس الگوی مستند-شده‌ی OpenRouter برای
// endpointهای async (submit → poll با job id) و ساختار endpoint.supported_video_parameters
// در کاتالوگ مدل (openroutermodels.json) نوشته شده — هنوز با یک curl واقعی روی حساب OpenRouter
// پروژه تست/تایید نشده (طبق انضباط خودِ EXECUTION-PLAN.md قدم ۲: «هر مدل با یک curl مستقیم
// تست شود»). قبل از تکیه‌ی پروداکشن، حتماً با یک درخواست واقعی این فرمت تایید/اصلاح شود.
export class VideoApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | null,
  ) {
    super(message);
  }
}

export type VideoJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

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
    if (params.referenceImage) {
      body.input_reference = `data:image/png;base64,${params.referenceImage.toString('base64')}`;
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
    let json: { id?: string; error?: { code?: string; message?: string } };
    try {
      json = JSON.parse(text);
    } catch {
      throw new VideoApiError(
        `OpenRouter /videos returned non-JSON response: ${text.slice(0, 300)}`,
        null,
      );
    }
    if (!res.ok || json.error || !json.id) {
      throw new VideoApiError(
        json.error?.message ?? text.slice(0, 300),
        json.error?.code ?? null,
      );
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
      video?: { url?: string };
      error?: { message?: string };
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
      throw new VideoApiError(json.error?.message ?? text.slice(0, 300), null);
    }
    return {
      status: json.status ?? 'processing',
      videoUrl: json.video?.url,
      error: json.error?.message,
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
