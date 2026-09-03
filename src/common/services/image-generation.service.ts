import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProviderService } from './ai-provider.service';

// استخراج‌شده از chat.service.ts (بخش تولید عکس در چت) تا هم چت هم ماژول جدید Discovery
// (نیوو/عکس-متن آماده) از یک پیاده‌سازی مشترک استفاده کنند، نه دو کپی جدا. این سرویس فقط به
// ConfigService/AiProviderService وابسته است — هیچ Prisma/Wallet/plan-ای اینجا نیست، عمداً:
// تصمیم کسر اعتبار/هزینه در لایه‌ی بالاتر (ChatService یا DiscoveryGenerationService) گرفته
// می‌شود، نه اینجا.
//
// نکته‌ی مهم درباره‌ی OpenRouter (docs/EXECUTION-PLAN.md قدم ۵): بر خلاف چت/متن، OpenRouter تولید
// عکس را برای خانواده‌ی مدل‌های چندوجهی (Gemini/GPT-image که الان در کاتالوگ هستند) از طریق همان
// `/chat/completions` با `modalities: ['image','text']` انجام می‌دهد، نه یک endpoint اختصاصی
// `/images/generations` مثل لیارا (تایید شده از داک/نمونه‌کد رسمی OpenRouter برای
// google/gemini-*-image، ۱۴۰۵-۰۶-۱۲). عکس خروجی در `choices[0].message.images[].image_url.url`
// (data URL) برمی‌گردد. به همین دلیل مسیر OpenRouter پیاده‌سازی کاملاً جدایی دارد
// (callOpenRouterImageChat) و partial_images/streaming (فقط قابلیت لیارا/gpt-image) را ندارد.

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

// سوییچ «چهره را تغییر نده» — هم توی چت معمولی (ویرایش عکس پیوست‌شده) هم توی سبک‌های
// استودیوی محتوا (discovery-generation.service.ts) استفاده می‌شود؛ فقط وقتی عکس ورودی
// داریم (editImage) معنا دارد — پیش‌فرض روشن (caller باید preserveFace !== false چک کند)
export const FACE_PRESERVATION_INSTRUCTION =
  'نکته‌ی بسیار مهم: چهره‌ی فرد(های) داخل عکس ورودی را دقیقاً حفظ کن — نسبت‌های صورت، فرم چشم/ابرو/بینی/لب/فک و رنگ پوست باید عیناً مطابق عکس اصلی کاربر بماند و تغییر نکند. فقط پس‌زمینه/لباس/سبک/نورپردازی را طبق درخواست تغییر بده، نه چهره.';

@Injectable()
export class ImageGenerationService {
  private readonly logger = new Logger(ImageGenerationService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly aiProvider: AiProviderService,
  ) {}

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
    if (this.aiProvider.isOpenRouter) {
      return this.callOpenRouterImageChat(
        params.modelId,
        params.prompt,
        params.apiKey,
      );
    }
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
    if (this.aiProvider.isOpenRouter) {
      return this.callOpenRouterImageChat(
        params.modelId,
        params.prompt,
        params.apiKey,
        params.images,
      );
    }
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
      // قدم ۴ — لیارا اصلاً این را ندارد، همیشه null
      realCostUsdMicros: number | null;
    };
  }> {
    const baseUrl = this.aiProvider.baseURL;
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
          realCostUsdMicros: null,
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
    let usage = {
      textInputTokens: 0,
      imageInputTokens: 0,
      outputTokens: 0,
      realCostUsdMicros: null as number | null,
    };

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
              realCostUsdMicros: null,
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

  // مسیر OpenRouter — همون توضیح بالای فایل: از /chat/completions با modalities:['image','text']
  // استفاده می‌کند، نه یک endpoint عکس جدا. onPartial/streaming پشتیبانی نمی‌شود (قابلیت
  // اختصاصی لیارا/gpt-image family بود)، پس پیش‌نمایش تدریجی روی OpenRouter عمداً غیرفعال است.
  private async callOpenRouterImageChat(
    modelId: string,
    prompt: string,
    apiKey: string,
    inputImages?: Buffer[],
  ): Promise<{
    base64: string;
    usage: {
      textInputTokens: number;
      imageInputTokens: number;
      outputTokens: number;
      realCostUsdMicros: number | null;
    };
  }> {
    const content: Array<Record<string, unknown>> = [
      { type: 'text', text: prompt },
    ];
    for (const buf of inputImages ?? []) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${buf.toString('base64')}` },
      });
    }

    const body = {
      model: modelId,
      modalities: ['image', 'text'],
      messages: [{ role: 'user', content }],
      usage: { include: true },
    };

    const doFetch = () =>
      fetch(`${this.aiProvider.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(this.aiProvider.extraHeaders ?? {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

    let res: Awaited<ReturnType<typeof doFetch>>;
    try {
      res = await doFetch();
      if (!res.ok && res.status >= 500) {
        this.logger.warn(
          `OpenRouter chat/completions (image) returned ${res.status}, retrying once`,
        );
        res = await doFetch();
      }
    } catch (err) {
      this.logger.warn(
        `OpenRouter chat/completions (image) network error, retrying once: ${(err as Error).message}`,
      );
      res = await doFetch();
    }

    const text = await res.text();
    type OpenRouterImageChatResponse = {
      choices?: Array<{
        message?: {
          content?: string | null;
          images?: Array<{ image_url?: { url?: string } }>;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        cost?: number;
      };
      error?: { code?: string | number; type?: string; message?: string };
    };
    let json: OpenRouterImageChatResponse;
    try {
      json = JSON.parse(text) as OpenRouterImageChatResponse;
    } catch {
      throw new Error(
        `OpenRouter chat/completions (image) returned non-JSON response: ${text.slice(0, 300)}`,
      );
    }

    if (!res.ok || json.error) {
      const code = json.error?.code ?? json.error?.type ?? null;
      const message = json.error?.message ?? text.slice(0, 300);
      const isPolicyViolation = /moderation|policy|safety/i.test(
        `${code ?? ''} ${message}`,
      );
      throw new ImageApiError(
        message,
        code == null ? null : String(code),
        isPolicyViolation,
      );
    }

    const imageUrl = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imageUrl)
      throw new Error(
        'OpenRouter chat/completions (image): no image returned in message.images — model may have refused or is not image-capable',
      );
    const base64 = imageUrl.replace(/^data:image\/\w+;base64,/, '');

    // اگر OpenRouter برای این مدل/درخواست usage.cost برنگرداند، کسر واقعی کیف‌پول به تخمین
    // توکنی برمی‌گردد (chat.service.ts:1422) — این لاگ نبودش را همان لحظه مشخص می‌کند تا حدس
    // زده نشود؛ سطح warn عمداً (نه debug) چون خودش نشانه‌ی یک مشکل واقعی در دقت صورت‌حساب است
    if (typeof json.usage?.cost !== 'number') {
      this.logger.warn(
        `OpenRouter chat/completions (image) model=${modelId} returned no usage.cost — falling back to token estimate. raw usage=${JSON.stringify(json.usage ?? null)}`,
      );
    }

    return {
      base64,
      usage: {
        // OpenRouter چت‌کامپلیشن‌ها usage را per-modality تفکیک نمی‌کنند (بر خلاف لیارا) — تا
        // تفکیک دقیق‌تر لازم بشه، همه‌ی ورودی زیر textInputTokens حساب می‌شود؛
        // imageInputTokens=0 یعنی هزینه‌ی عکس ورودی در حالت edit موقتاً دست‌کم گرفته می‌شود، نه
        // بیش‌برآورد — عمداً محافظه‌کارانه به نفع کاربر. realCostUsdMicros واقعی جبرانش می‌کند
        // چون از کل هزینه‌ی دلاری واقعی provider (usage.cost، تست‌شده روی API واقعی) می‌آید،
        // نه از این تخمین توکنی
        textInputTokens: json.usage?.prompt_tokens ?? 0,
        imageInputTokens: 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        realCostUsdMicros:
          typeof json.usage?.cost === 'number'
            ? Math.round(json.usage.cost * 1_000_000)
            : null,
      },
    };
  }
}
