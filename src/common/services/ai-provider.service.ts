import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { MetadataExtractor } from '@ai-sdk/openai-compatible';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

export type AiProviderName = 'liara' | 'openrouter';

// docs/EXECUTION-PLAN.md قدم ۴ — کلیدی که هزینه‌ی واقعی OpenRouter زیر آن در
// `result.providerMetadata` برمی‌گردد؛ تایید‌شده با تست مستقیم روی API واقعی (۱۴۰۵-۰۶-۱۲):
// caller ها با `(await result.providerMetadata)?.[OPENROUTER_METADATA_KEY]?.cost` می‌خوانندش
export const OPENROUTER_METADATA_KEY = 'openrouter';

type OpenRouterUsage = {
  cost?: number;
  cost_details?: {
    upstream_inference_cost?: number;
    upstream_inference_prompt_cost?: number;
    upstream_inference_completions_cost?: number;
  };
};

// هزینه‌ی واقعی per-request OpenRouter (usage.cost، دلار) — در کنار تخمین داخلی فعلی ذخیره
// می‌شود، نه به‌جای آن (طبق §۶.۲.۲ سند اصلی). ساخته‌شده و تست‌شده مستقیم روی API واقعی
// OpenRouter: هم مسیر non-streaming (extractMetadata) هم streaming (createStreamExtractor) —
// usage با cost فقط در آخرین chunk استریم می‌آید، نه هر chunk
function createOpenRouterMetadataExtractor(): MetadataExtractor {
  const toMetadata = (usage: OpenRouterUsage | undefined) => {
    if (!usage || typeof usage.cost !== 'number') return undefined;
    return {
      [OPENROUTER_METADATA_KEY]: {
        cost: usage.cost,
        costDetails: usage.cost_details,
      },
    };
  };
  return {
    extractMetadata({ parsedBody }) {
      const usage = (parsedBody as { usage?: OpenRouterUsage } | undefined)
        ?.usage;
      return Promise.resolve(toMetadata(usage));
    },
    createStreamExtractor() {
      let usage: OpenRouterUsage | undefined;
      return {
        processChunk(parsedChunk: unknown) {
          const chunkUsage = (
            parsedChunk as { usage?: OpenRouterUsage } | undefined
          )?.usage;
          if (chunkUsage && typeof chunkUsage.cost === 'number')
            usage = chunkUsage;
        },
        buildMetadata() {
          return toMetadata(usage);
        },
      };
    },
  };
}

// docs/PRD-openrouter-migration.md §۶.۱ + docs/EXECUTION-PLAN.md قدم ۱ — نقطه‌ی واحد کنترل
// provider که همه‌ی سرویس‌های AI (چت/روتر مدل/فروش/nivo-cal/فیدبک/discovery/...) به‌جای ساختن
// جدا-جدای createOpenAICompatible، از همین‌جا کلاینت می‌گیرند. با یک env var
// (AI_PROVIDER=liara|openrouter) کل پلتفرم سوییچ می‌کند — بدون رول‌بک کد، فقط ری‌دیپلوی.
// پیش‌فرض عمداً «liara» است تا استخراج این سرویس به‌تنهایی هیچ رفتار پروداکشن فعلی را عوض نکند.
@Injectable()
export class AiProviderService {
  private proxyAgent?: ProxyAgent;

  constructor(private readonly config: ConfigService) {}

  get name(): AiProviderName {
    return this.config.get<string>('AI_PROVIDER') === 'openrouter'
      ? 'openrouter'
      : 'liara';
  }

  get isOpenRouter(): boolean {
    return this.name === 'openrouter';
  }

  // مقدار enum AiPlatform روی AiModel.platform — کوئری‌های انتخاب مدل برای کاربر نهایی
  // (chat.service.ts, model-router.service.ts, discovery-generation.service.ts,
  // plans.service.ts) باید همیشه با این فیلتر شوند تا ردیف‌هایی که روی provider فعلی
  // معتبر نیستند (شناسه‌شان بین لیارا/OpenRouter فرق دارد) هرگز انتخاب نشوند
  get platform(): 'LIARA' | 'OPENROUTER' {
    return this.isOpenRouter ? 'OPENROUTER' : 'LIARA';
  }

  get baseURL(): string {
    return this.isOpenRouter
      ? (this.config.get<string>('OPENROUTER_BASE_URL') ??
          'https://openrouter.ai/api/v1')
      : this.config.get<string>('LIARA_AI_BASE_URL')!;
  }

  // کلید مشترک پلتفرم برای provider فعال — برای مسیرهایی که کلید اختصاصی-به‌ازای-کاربر معنا
  // ندارد یا هنوز برای این provider ساخته نشده (Provisioning API Keys اختصاصی OpenRouter، طبق
  // §۵.۱ سند اصلی، هنوز پیاده‌سازی نشده — فقط لیارا این مکانیزم را دارد)
  get sharedApiKey(): string {
    return this.isOpenRouter
      ? this.config.get<string>('OPENROUTER_API_KEY')!
      : this.config.get<string>('LIARA_API_KEY')!;
  }

  // سرویس‌هایی که امروز کلید اختصاصی-به‌ازای-کاربر لیارا را امتحان می‌کنند (liara-key-provisioning)
  // باید این را چک کنند: روی OpenRouter هنوز چنین مکانیزمی نداریم، پس مستقیم به کلید مشترک بروند
  // به‌جای تلاش بی‌فایده برای provisioning لیارا
  get supportsPerUserKeys(): boolean {
    return !this.isOpenRouter;
  }

  // هدرهای پیشنهادی OpenRouter برای attribution/ranking (§۱۰ بند ۵ سند اصلی) — اختیاری،
  // فقط آماری، تأثیری در عملکرد ندارد. public چون caller های fetch خام (مثل
  // image-generation.service.ts که از buildClient/AI SDK استفاده نمی‌کنند) هم به آن نیاز دارند
  get extraHeaders(): Record<string, string> | undefined {
    if (!this.isOpenRouter) return undefined;
    const headers: Record<string, string> = {};
    const siteUrl = this.config.get<string>('OPENROUTER_SITE_URL');
    const appName = this.config.get<string>('OPENROUTER_APP_NAME');
    const relaySecret = this.config.get<string>('OPENROUTER_RELAY_SECRET');
    if (siteUrl) headers['HTTP-Referer'] = siteUrl;
    if (appName) headers['X-Title'] = appName;
    // فقط وقتی OPENROUTER_BASE_URL به دامنه‌ی openrouter-relay (پروژه‌ی جدا) اشاره می‌کند
    // معنا دارد — خودِ OpenRouter این هدر را نادیده می‌گیرد، پس همیشه امن است اضافه شود.
    if (relaySecret) headers['X-Relay-Secret'] = relaySecret;
    return Object.keys(headers).length ? headers : undefined;
  }

  // زیرساخت پروداکشن (Darkube/همروش) داخل ایران است و OpenRouter پشت Cloudflare سرو می‌شود —
  // اتصال مستقیم گاهی با connect-timeout مواجه می‌شود (فیلترینگ/مسیریابی رنج‌های Cloudflare).
  // OPENROUTER_PROXY_URL اختیاری است (مثلاً یک HTTP(S) proxy روی یک سرور خارج از ایران)؛ فقط
  // ترافیک OpenRouter از آن رد می‌شود، نه Liara یا بقیه‌ی fetch های اپ.
  private get proxyDispatcher(): ProxyAgent | undefined {
    if (!this.isOpenRouter) return undefined;
    const proxyUrl = this.config.get<string>('OPENROUTER_PROXY_URL');
    if (!proxyUrl) return undefined;
    if (!this.proxyAgent) this.proxyAgent = new ProxyAgent(proxyUrl);
    return this.proxyAgent;
  }

  // fetch سفارشی که caller های OpenRouter (هم AI SDK از طریق buildClient، هم fetch خام در
  // image-generation.service.ts) باید به‌جایِ global fetch استفاده کنند؛ undefined یعنی
  // OPENROUTER_PROXY_URL ست نشده و باید global fetch معمولی استفاده شود.
  //
  // عمداً از globalThis.fetch با آپشن dispatcher استفاده نمی‌شود: Node (اینجا v22) یک نسخه‌ی
  // داخلی/vendored از undici را برای global fetch باندل می‌کند (مثلاً v6.x) که با نسخه‌ی
  // نصب‌شده‌ی جدامون در package.json (v8.x، برای ProxyAgent) فرق دارد. دو نسخه‌ی undici
  // اینترفیس داخلی Handler ناسازگار دارند، پس دادن dispatcher نسخه‌ی جدید به fetch نسخه‌ی
  // قدیمی همان خطای «invalid onRequestStart method» را می‌دهد. راه‌حل: fetch را هم از همان
  // پکیج undici که ProxyAgent را ساخته می‌گیریم (نه globalThis.fetch)، تا نسخه‌ها یکی باشند.
  get fetch(): typeof globalThis.fetch | undefined {
    const dispatcher = this.proxyDispatcher;
    if (!dispatcher) return undefined;
    return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      undiciFetch(input as string, {
        ...(init as Record<string, unknown>),
        dispatcher,
      })) as unknown as typeof globalThis.fetch;
  }

  // apiKey اختیاری برای caller هایی که کلید اختصاصی خودشان را resolve کرده‌اند (مثل
  // resolveUserApiKey در chat.service.ts)؛ اگر پاس داده نشود، کلید مشترک provider فعال استفاده
  // می‌شود. extraOptions برای موارد خاص مثل supportsStructuredOutputs (nivo-cal.service.ts).
  buildClient(apiKey?: string, extraOptions?: Record<string, unknown>) {
    return createOpenAICompatible({
      name: this.name,
      baseURL: this.baseURL,
      apiKey: apiKey ?? this.sharedApiKey,
      ...(this.extraHeaders ? { headers: this.extraHeaders } : {}),
      ...(this.fetch ? { fetch: this.fetch } : {}),
      // قدم ۴ — فقط روی OpenRouter: usage.cost واقعی را از provider بخواه و زیر
      // OPENROUTER_METADATA_KEY در providerMetadata نتیجه در دسترس caller بگذار.
      // همچنین: @ai-sdk/openai-compatible فیلد reasoningEffort را به‌صورت مسطح
      // `reasoning_effort` در بادی می‌سازد (فرمت خودِ OpenAI) — اما OpenRouter طبق مستنداتش
      // انتظار آبجکت تودرتوی `reasoning: {effort}` دارد و فیلد مسطح را نادیده می‌گیرد. اینجا
      // قبل از ارسال، مسطح را به فرمت مورد انتظار OpenRouter تبدیل می‌کنیم.
      ...(this.isOpenRouter
        ? {
            transformRequestBody: (body: Record<string, unknown>) => {
              const { reasoning_effort, ...rest } = body as {
                reasoning_effort?: string;
                [key: string]: unknown;
              };
              return {
                ...rest,
                ...(reasoning_effort
                  ? { reasoning: { effort: reasoning_effort } }
                  : {}),
                usage: { include: true },
              };
            },
            metadataExtractor: createOpenRouterMetadataExtractor(),
          }
        : {}),
      ...extraOptions,
    });
  }
}
