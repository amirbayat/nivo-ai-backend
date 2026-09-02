import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { MetadataExtractor } from '@ai-sdk/openai-compatible';

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
    if (siteUrl) headers['HTTP-Referer'] = siteUrl;
    if (appName) headers['X-Title'] = appName;
    return Object.keys(headers).length ? headers : undefined;
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
      // قدم ۴ — فقط روی OpenRouter: usage.cost واقعی را از provider بخواه و زیر
      // OPENROUTER_METADATA_KEY در providerMetadata نتیجه در دسترس caller بگذار
      ...(this.isOpenRouter
        ? {
            transformRequestBody: (body: Record<string, unknown>) => ({
              ...body,
              usage: { include: true },
            }),
            metadataExtractor: createOpenRouterMetadataExtractor(),
          }
        : {}),
      ...extraOptions,
    });
  }
}
