import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// استخراج‌شده از chat.service.ts (بخش تولید عکس در چت) تا هم چت هم ماژول جدید Discovery
// (نیوو/عکس-متن آماده) از یک پیاده‌سازی مشترک استفاده کنند، نه دو کپی جدا. این سرویس فقط به
// ConfigService (برای LIARA_AI_BASE_URL) وابسته است — هیچ Prisma/Wallet/plan-ای اینجا نیست،
// عمداً: تصمیم کسر اعتبار/هزینه در لایه‌ی بالاتر (ChatService یا DiscoveryGenerationService)
// گرفته می‌شود، نه اینجا.

// برای تشخیص «رد شدن به‌خاطر سیاست محتوا» از یک خطای معمولی/گذرا — کاربر باید بفهمه باید
// توصیفش رو عوض کنه، نه صرفاً دوباره امتحان کنه
export class ImageApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | null,
    public readonly isPolicyViolation: boolean,
  ) {
    super(message);
  }
}

@Injectable()
export class ImageGenerationService {
  private readonly logger = new Logger(ImageGenerationService.name);

  constructor(private readonly config: ConfigService) {}

  // تولید از صفر — بدون عکس ورودی (docs: /v1/images/generations). partial_images یعنی provider
  // تا ۲ پیش‌نمایش تدریجی (هر بار واضح‌تر) قبل از تصویر نهایی برمی‌گرداند — دقیقاً همون افکت
  // progressive-reveal که ChatGPT نشون می‌ده، نه یک انیمیشن تزئینی صرف
  async generateImage(params: {
    modelId: string;
    prompt: string;
    apiKey: string;
    size?: string;
    quality?: string;
    onPartial?: (base64: string) => void;
  }) {
    return this.callImagesApi(
      '/images/generations',
      {
        model: params.modelId,
        prompt: params.prompt,
        n: 1,
        ...(params.size ? { size: params.size } : {}),
        ...(params.quality ? { quality: params.quality } : {}),
        ...(params.onPartial ? { stream: true, partial_images: 2 } : {}),
      },
      params.apiKey,
      params.onPartial,
    );
  }

  // ویرایش/ترکیب چند عکس موجود با یک prompt (docs: /v1/images/edits) — کاربر خودش عکس(ها) را
  // فرستاده و می‌خواهد ویرایش/ترکیب شوند، نه یک تصویر کاملاً جدید
  async editImage(params: {
    modelId: string;
    prompt: string;
    images: Buffer[];
    apiKey: string;
    size?: string;
    quality?: string;
    onPartial?: (base64: string) => void;
  }) {
    const form = new FormData();
    form.append('model', params.modelId);
    form.append('prompt', params.prompt);
    if (params.size) form.append('size', params.size);
    if (params.quality) form.append('quality', params.quality);
    if (params.onPartial) {
      form.append('stream', 'true');
      form.append('partial_images', '2');
    }
    // فرمت چندفایلی استاندارد multipart — یک فایل: کلید ساده «image»، چند فایل: کلید تکرارشونده‌ی
    // «image[]» (همون قراردادی که OpenAI/gpt-image-1 می‌پذیرد)
    const imageKey = params.images.length > 1 ? 'image[]' : 'image';
    params.images.forEach((buf, i) => {
      form.append(
        imageKey,
        new Blob([new Uint8Array(buf)], { type: 'image/png' }),
        `image-${i}.png`,
      );
    });
    return this.callImagesApi(
      '/images/edits',
      form,
      params.apiKey,
      params.onPartial,
    );
  }

  private async callImagesApi(
    path: '/images/generations' | '/images/edits',
    body: Record<string, unknown> | FormData,
    apiKey: string,
    onPartial?: (base64: string) => void,
  ): Promise<{
    base64: string;
    usage: {
      textInputTokens: number;
      imageInputTokens: number;
      outputTokens: number;
    };
  }> {
    const baseUrl = this.config.get<string>('LIARA_AI_BASE_URL')!;
    const isFormData = body instanceof FormData;
    // بعضی مدل‌ها (تأیید شده برای gpt-image-1-mini روی گیت‌وی ما) اصلاً stream/partial_images
    // را قبول نمی‌کنند و با خطا رد می‌کنند — این پرچم اجازه می‌دهد بدون stream دوباره تلاش کنیم
    // به‌جای اینکه کل تولید عکس fail شود
    let streaming = Boolean(onPartial);

    const stripStreamingParams = () => {
      if (isFormData) {
        body.delete('stream');
        body.delete('partial_images');
      } else {
        delete body.stream;
        delete body.partial_images;
      }
    };

    const doFetch = () =>
      fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        },
        body: isFormData ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

    // یک retry برای خطاهای گذرا (قطعی شبکه یا ۵xx از سمت provider) — نه برای ۴xx (مثل رد شدن
    // به‌خاطر سیاست محتوا، که دوباره‌تلاش هیچ فرقی نمی‌کند، فقط هزینه/تأخیر اضافه می‌کند)
    let res: Awaited<ReturnType<typeof doFetch>>;
    try {
      res = await doFetch();
      if (!res.ok && res.status >= 500) {
        this.logger.warn(
          `Liara images API ${path} returned ${res.status}, retrying once`,
        );
        res = await doFetch();
      }
    } catch (err) {
      this.logger.warn(
        `Liara images API ${path} network error, retrying once: ${(err as Error).message}`,
      );
      res = await doFetch();
    }

    if (!res.ok) {
      let text = await res.text().catch(() => '');
      // بعضی مدل‌ها اصلاً stream/partial_images را قبول نمی‌کنند — به‌جای fail کردن کل تولید
      // عکس، بدون streaming دوباره تلاش می‌کنیم (پیش‌نمایش تدریجی را برای این یک مدل از دست
      // می‌دهیم، ولی خودِ تولید عکس کار می‌کند)
      if (
        streaming &&
        /does not support streaming|streaming.*not supported/i.test(text)
      ) {
        this.logger.warn(
          `${path}: model doesn't support streaming, retrying without partial_images`,
        );
        streaming = false;
        stripStreamingParams();
        res = await doFetch();
        if (!res.ok) text = await res.text().catch(() => '');
      }

      if (!res.ok) {
        let code: string | null = null;
        let message = text.slice(0, 300);
        try {
          const errJson = JSON.parse(text) as {
            error?: { code?: string; type?: string; message?: string };
          };
          code = errJson.error?.code ?? errJson.error?.type ?? null;
          message = errJson.error?.message ?? message;
        } catch {
          // بدنه‌ی خطا JSON نبود — همون متن خام کافیه
        }
        // gpt-image family این کدها را برای رد شدن به‌خاطر سیاست محتوا برمی‌گرداند — تشخیصش لازم است
        // تا به کاربر بگیم «prompt رو عوض کن»، نه یک پیام خطای عمومی/گیج‌کننده
        const isPolicyViolation = /moderation|policy|safety/i.test(
          `${code ?? ''} ${message}`,
        );
        throw new ImageApiError(message, code, isPolicyViolation);
      }
    }

    if (!streaming) {
      const json = (await res.json()) as {
        data?: Array<{ b64_json?: string }>;
        usage?: {
          input_tokens_details?: {
            text_tokens?: number;
            image_tokens?: number;
          };
          output_tokens?: number;
        };
      };
      const base64 = json.data?.[0]?.b64_json;
      if (!base64)
        throw new Error(`Liara images API ${path} returned no image data`);
      return {
        base64,
        // اگر provider اصلاً usage برنگرداند (بعضی مدل‌ها/gatewayها ممکن است ندهند)، صفر می‌شود —
        // یعنی آن بخش هزینه صفر حساب می‌شود؛ بهتر از crash کردن، ولی باید توی لاگ مشخص باشد
        usage: {
          textInputTokens: json.usage?.input_tokens_details?.text_tokens ?? 0,
          imageInputTokens: json.usage?.input_tokens_details?.image_tokens ?? 0,
          outputTokens: json.usage?.output_tokens ?? 0,
        },
      };
    }

    // حالت streaming — docs: هر خط SSE یک JSON با فیلد type است:
    // "image_generation.partial_image" (پیش‌نمایش تدریجی، هر بار واضح‌تر) و در پایان
    // "image_generation.completed" (تصویر و usage نهایی)
    if (!res.body)
      throw new Error(
        `Liara images API ${path} streaming response has no body`,
      );
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalBase64: string | null = null;
    let usage = { textInputTokens: 0, imageInputTokens: 0, outputTokens: 0 };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (raw === '[DONE]') continue;
        try {
          const evt = JSON.parse(raw) as {
            type?: string;
            b64_json?: string;
            usage?: {
              input_tokens_details?: {
                text_tokens?: number;
                image_tokens?: number;
              };
              output_tokens?: number;
            };
          };
          if (evt.type === 'image_generation.partial_image' && evt.b64_json) {
            onPartial?.(evt.b64_json);
          } else if (
            evt.type === 'image_generation.completed' &&
            evt.b64_json
          ) {
            finalBase64 = evt.b64_json;
            usage = {
              textInputTokens:
                evt.usage?.input_tokens_details?.text_tokens ?? 0,
              imageInputTokens:
                evt.usage?.input_tokens_details?.image_tokens ?? 0,
              outputTokens: evt.usage?.output_tokens ?? 0,
            };
          }
        } catch {
          // یک خط ناقص/نامعتبر — نادیده بگیر، خط بعدی می‌رسه
        }
      }
    }

    if (!finalBase64)
      throw new Error(
        `Liara images API ${path} streaming ended without a completed image`,
      );
    return { base64: finalBase64, usage };
  }
}
