import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export type AiProviderName = 'liara' | 'openrouter';

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
  // فقط آماری، تأثیری در عملکرد ندارد
  private get extraHeaders(): Record<string, string> | undefined {
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
      ...extraOptions,
    });
  }
}
