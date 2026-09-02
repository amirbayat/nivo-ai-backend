import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateObject } from 'ai';
import { z } from 'zod';
import { ModelTier, type AiModel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PricingService } from '../usage/pricing.service';
import { LiveStatsService } from '../live-stats/live-stats.service';
import { AiProviderService } from '../../common/services/ai-provider.service';

const CONFIG_CACHE_KEY = 'model_routing_config:cache';
const CONFIG_CACHE_TTL = 60; // ثانیه
const STEPS_CACHE_TTL = 60; // ثانیه
const SINGLETON_ID = 'singleton';

const DEFAULT_SIMPLE_KEYWORDS = [
  'سلام',
  'خداحافظ',
  'ممنون',
  'مرسی',
  'باشه',
  'یعنی چی',
  'ترجمه کن',
  'کوتاه بگو',
];
const DEFAULT_COMPLEX_KEYWORDS = [
  'دیباگ',
  'معماری',
  'الگوریتم',
  'ثابت کن',
  'قدم به قدم',
  'تحلیل کن',
  'مقایسه کن',
  'بهینه‌سازی',
  'قرارداد',
  'کد کامل بنویس',
];

interface RoutingConfigShape {
  enabled: boolean;
  simpleKeywords: string[];
  complexKeywords: string[];
  complexLenThreshold: number;
  llmFallbackEnabled: boolean;
  llmFallbackModel: string;
}

interface RoutingStepShape {
  order: number;
  thresholdPct: number;
  models: string[];
  reasoningEffort: string | null;
}

export interface RouteInput {
  userId: string;
  content: string;
  hasImages: boolean;
  allowedModels: string[];
  manualModel?: string;
  lastAssistantMessageLength?: number;
  planId?: string; // اگر خالی باشد (مثلاً پلن رایگان در دیتابیس پیدا نشد)، مسیریابی استپی غیرفعال می‌شود
  usagePct: number; // ۰ تا ۱۰۰+ — درصد مصرف بودجه‌ی روزانه
  simpleModel?: string | null; // مدل ثابت پلن برای پیام‌های SIMPLE
  reasoningEffort?: string | null; // پیش‌فرض reasoning effort پلن — استپ فعلی می‌تواند override کند
  // docs/PRD-pay-as-you-go-wallet.md — بدون طبقه‌بندی/fallback پله‌ای SIMPLE/MEDIUM/COMPLEX قدیمی؛
  // انتخاب مدل این پلن یا دستی است، یا یکی از دو حالت خودکار زیر (selectionMode)
  isPayAsYouGo?: boolean;
  // docs/PRD-model-selection-modes.md — فقط وقتی isPayAsYouGo=true و manualModel خالی باشد اثر دارد:
  // 'cost_optimized' → ارزان‌ترین مدل مجاز (بر اساس مجموع inputPricePerM+outputPricePerM)
  // 'best_answer'    → قوی‌ترین مدل مجاز صرف‌نظر از قیمت (بالاترین tier، سپس گران‌ترین به‌عنوان تای‌بریک)
  selectionMode?: 'cost_optimized' | 'best_answer';
}

export interface RouteResult {
  modelId: string;
  tier: ModelTier;
  method: string;
  confidence: number;
  overriddenManualModel: string | null;
  // نهایی، بعد از اعمال override استپ (اگر بود) روی پیش‌فرض پلن — ممکن است null باشد (پیش‌فرض provider)
  reasoningEffort: string | null;
}

const TIER_RANK: Record<ModelTier, number> = {
  SIMPLE: 0,
  MEDIUM: 1,
  COMPLEX: 2,
};

// تصمیم محصول (۱۴۰۵/۰۶) — حالت «مصرف بهینه» (متنی) فقط بین همین مدل(ها) انتخاب می‌کند، نه
// ارزان‌ترین کل کاتالوگ. اگر هیچ‌کدام در استخر کاندیدها نبودند (مثلاً غیرفعال شده‌اند)،
// pickBySelectionMode به رفتار قدیمی (ارزان‌ترین کل کاندیدها) fallback می‌کند.
// docs/PRD-openrouter-migration.md §۱۳.۵/۱۴.۹ — قبلاً بین nano/mini بسته به قیمت انتخاب
// می‌شد (nano ارزان‌تر همیشه برنده بود)؛ طبق تصمیم صریح کاربر، پیش‌فرض کاربر جدید حالا ثابت
// روی gpt-5.4-mini است (تجربه‌ی یکنواخت‌تر، با پذیرفتن هزینه‌ی کمی بالاتر) — nano دیگر در این
// استخر خودکار انتخاب نمی‌شود مگر کاربر صریح خودش انتخابش کند
const COST_OPTIMIZED_MODEL_NAMES = ['openai/gpt-5.4-mini'];

@Injectable()
export class ModelRouterService {
  private readonly logger = new Logger(ModelRouterService.name);
  private readonly provider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly pricingService: PricingService,
    private readonly liveStats: LiveStatsService,
    private readonly aiProvider: AiProviderService,
  ) {
    this.provider = this.aiProvider.buildClient();
  }

  async route(input: RouteInput): Promise<RouteResult> {
    // docs/PRD-model-selection-modes.md — کلاً از مسیر classify/steps پله‌ای بودجه‌ای رد می‌شود:
    // یا انتخاب دستی کاربر عیناً استفاده می‌شود، یا یکی از دو حالت خودکار (مصرف بهینه/بهترین پاسخ)
    // بین مدل‌های مجاز پلن انتخاب می‌کند و دقیقاً همان مدل واقعاً استفاده‌شده از کیف‌پول کم می‌شود
    if (input.isPayAsYouGo) {
      return this.routePayAsYouGo(input);
    }

    const config = await this.getConfig();

    if (!config.enabled) {
      const modelId = input.manualModel ?? input.allowedModels[0];
      return {
        modelId,
        tier: ModelTier.MEDIUM,
        method: 'disabled',
        confidence: 1,
        overriddenManualModel: null,
        reasoningEffort: input.reasoningEffort ?? null,
      };
    }

    const { tier, method, confidence } = await this.classify(input, config);

    const candidates = await this.prisma.aiModel.findMany({
      where: {
        name: { in: input.allowedModels },
        isActive: true,
        modelType: 'CHAT', // مدل‌های embedding و IMAGE_GEN (که اصلاً قابلیت تولید متن ندارند) هرگز نباید برای پاسخ چت معمولی انتخاب شوند
        platform: { has: this.aiProvider.platform },
        ...(input.hasImages ? { supportsVision: true } : {}),
      },
      orderBy: { sortOrder: 'asc' },
    });

    // هیچ مدل مجازی شرایط (مثلاً vision) رو نداره — فال‌بک امن به انتخاب فعلی
    if (!candidates.length) {
      return {
        modelId: input.manualModel ?? input.allowedModels[0],
        tier,
        method,
        confidence,
        overriddenManualModel: null,
        reasoningEffort: input.reasoningEffort ?? null,
      };
    }

    if (tier === ModelTier.SIMPLE) {
      return this.routeSimple(input, candidates, tier, method, confidence);
    }

    return this.routeMediumComplex(input, candidates, tier, method, confidence);
  }

  private async routePayAsYouGo(input: RouteInput): Promise<RouteResult> {
    // انتخاب دستی کاربر — عیناً همان مدل، بدون هیچ override‌ای (docs/PRD-model-selection-modes.md بخش ۳.۱)
    if (input.manualModel) {
      return {
        modelId: input.manualModel,
        tier: ModelTier.MEDIUM,
        method: 'payg_manual',
        confidence: 1,
        overriddenManualModel: null,
        reasoningEffort: input.reasoningEffort ?? null,
      };
    }

    // isPayAsYouGo یعنی بدون محدودیت پلن — کل کاتالوگ فعال، فقط بعداً با موجودی کیف‌پول
    // محدود می‌شود (نه اینجا با plan.allowedModels که مخصوص پلن‌های اشتراکی قدیمی است)
    const candidates = await this.prisma.aiModel.findMany({
      where: {
        isActive: true,
        modelType: 'CHAT',
        platform: { has: this.aiProvider.platform },
        ...(input.hasImages ? { supportsVision: true } : {}),
      },
    });

    // هیچ مدل مجازی شرایط رو نداره (مثلاً هیچ‌کدام vision ندارند) — فال‌بک امن
    if (!candidates.length) {
      return {
        modelId: input.allowedModels[0],
        tier: ModelTier.MEDIUM,
        method: 'payg_fallback_empty',
        confidence: 1,
        overriddenManualModel: null,
        reasoningEffort: input.reasoningEffort ?? null,
      };
    }

    // پیش‌فرض وقتی هیچ selectionMode مشخصی نرسیده (نه انتخاب دستی، نه سنتینل صریح) — مصرف بهینه
    const effectiveMode =
      input.selectionMode === 'best_answer' ? 'best_answer' : 'cost_optimized';
    // simpleModel (فیلد «مدل ساده» پلن، از صفحه‌ی «مسیریابی مدل‌ها» در ادمین) دیفالت متنی
    // مصرف‌بهینه را هم override می‌کند — قبلاً فقط routeSimple (مسیر تیری قدیمی) این را می‌خواند
    const picked = this.pickBySelectionMode(
      candidates,
      effectiveMode,
      input.simpleModel,
    );
    return {
      modelId: picked.name,
      tier: picked.tier,
      method:
        effectiveMode === 'cost_optimized'
          ? 'payg_cost_optimized'
          : 'payg_best_answer',
      confidence: 1,
      overriddenManualModel: null,
      reasoningEffort: input.reasoningEffort ?? null,
    };
  }

  // docs/PRD-model-selection-modes.md — سیاست دو حالت خودکار، مشترک بین همه‌ی مصرف‌کننده‌ها
  // (چت PAYG، استخراج پرامپت از عکس، ...). یک‌جا نگه‌داشتنش یعنی این‌ها هرگز از هم واگرا نمی‌شوند.
  pickBySelectionMode(
    candidates: AiModel[],
    selectionMode: 'cost_optimized' | 'best_answer',
    preferredModelName?: string | null,
  ): AiModel {
    if (selectionMode === 'cost_optimized') {
      // مدل ادمین‌انتخاب‌شده (وقتی بین کاندیدهای معتبر همین درخواست هم هست — مثلاً وقتی
      // hasImages باعث فیلتر supportsVision شده) روی استخر هاردکد پیش‌فرض ارجحیت دارد
      if (preferredModelName) {
        const exact = candidates.find((c) => c.name === preferredModelName);
        if (exact) return exact;
      }
      const preferred = candidates.filter((c) =>
        COST_OPTIMIZED_MODEL_NAMES.includes(c.name),
      );
      const pool = preferred.length ? preferred : candidates;
      // ارزان‌ترین مدلِ توانا (در استخر بالا) — مجموع قیمت ورودی+خروجی به ازای هر میلیون توکن، صعودی
      return [...pool].sort(
        (a, b) =>
          a.inputPricePerM +
          a.outputPricePerM -
          (b.inputPricePerM + b.outputPricePerM),
      )[0];
    }

    // 'best_answer': قوی‌ترین مدل مجاز صرف‌نظر از قیمت — بالاترین tier، و در صورت تساوی tier،
    // گران‌ترین (proxy برای باکیفیت‌تر در همان سطح)
    return [...candidates].sort((a, b) => {
      const tierDiff = TIER_RANK[b.tier] - TIER_RANK[a.tier];
      if (tierDiff !== 0) return tierDiff;
      return (
        b.inputPricePerM +
        b.outputPricePerM -
        (a.inputPricePerM + a.outputPricePerM)
      );
    })[0];
  }

  private routeSimple(
    input: RouteInput,
    candidates: AiModel[],
    tier: ModelTier,
    method: string,
    confidence: number,
  ): RouteResult {
    // مدل ثابت پلن برای SIMPLE — اگر تنظیم و در دسترس باشد؛ وگرنه رفتار قدیمی (ارزان‌ترین کاندید SIMPLE)
    const fixed = input.simpleModel
      ? candidates.find((c) => c.name === input.simpleModel)
      : undefined;
    const modelId = fixed
      ? fixed.name
      : this.pickFromCandidates(candidates, ModelTier.SIMPLE);

    return {
      modelId,
      tier,
      method: fixed ? 'simple_fixed' : method,
      confidence,
      overriddenManualModel:
        input.manualModel && input.manualModel !== modelId
          ? input.manualModel
          : null,
      // برای SIMPLE استپ‌بندی وجود ندارد — فقط پیش‌فرض پلن
      reasoningEffort: input.reasoningEffort ?? null,
    };
  }

  private async routeMediumComplex(
    input: RouteInput,
    candidates: AiModel[],
    tier: ModelTier,
    method: string,
    confidence: number,
  ): Promise<RouteResult> {
    const steps = input.planId ? await this.getSteps(input.planId) : [];

    // پلن استپ تعریف نکرده (مثلاً رایگان) — رفتار قدیمی بدون تغییر
    if (!steps.length) {
      if (
        input.manualModel &&
        candidates.some((c) => c.name === input.manualModel)
      ) {
        return {
          modelId: input.manualModel,
          tier,
          method: 'manual',
          confidence: 1,
          overriddenManualModel: null,
          reasoningEffort: input.reasoningEffort ?? null,
        };
      }
      const modelId = this.pickFromCandidates(candidates, tier);
      return {
        modelId,
        tier,
        method,
        confidence,
        overriddenManualModel: null,
        reasoningEffort: input.reasoningEffort ?? null,
      };
    }

    const firstStep = steps[0];
    const currentStep =
      steps.find((s) => input.usagePct <= s.thresholdPct) ??
      steps[steps.length - 1];

    // وفاداری به انتخاب دستی — فقط تا سقف استپ اول همین پلن
    if (
      input.manualModel &&
      input.usagePct <= firstStep.thresholdPct &&
      candidates.some((c) => c.name === input.manualModel)
    ) {
      return {
        modelId: input.manualModel,
        tier,
        method: 'manual',
        confidence: 1,
        overriddenManualModel: null,
        reasoningEffort:
          firstStep.reasoningEffort ?? input.reasoningEffort ?? null,
      };
    }

    const stepCandidates = candidates.filter((c) =>
      currentStep.models.includes(c.name),
    );
    // اگر استپ فعلی هیچ مدل معتبری نداشت (مثلاً همه isActive=false شدند)، فال‌بک به کل کاندیدهای پلن
    const pool = stepCandidates.length ? stepCandidates : candidates;
    const preferredOrder = stepCandidates.length
      ? currentStep.models
      : undefined;

    const modelId = this.pickFromCandidates(pool, tier, preferredOrder);
    return {
      modelId,
      tier,
      method: stepCandidates.length ? 'budget_step' : method,
      confidence,
      overriddenManualModel:
        input.manualModel && input.manualModel !== modelId
          ? input.manualModel
          : null,
      // استپ فعلی می‌تواند reasoning effort را override کند؛ وگرنه از پیش‌فرض پلن ارث می‌برد
      reasoningEffort:
        currentStep.reasoningEffort ?? input.reasoningEffort ?? null,
    };
  }

  /** لاگ async — هیچ‌وقت نباید فلوی چت رو کند یا مختل کنه */
  async log(
    input: { userId: string; conversationId: string } & RouteResult,
  ): Promise<void> {
    try {
      await this.prisma.modelRoutingLog.create({
        data: {
          userId: input.userId,
          conversationId: input.conversationId,
          chosenModel: input.modelId,
          tier: input.tier,
          method: input.method,
          confidence: input.confidence,
          overrodeManual: input.overriddenManualModel,
        },
      });
    } catch (err) {
      this.logger.warn(
        `failed to write ModelRoutingLog: ${(err as Error).message}`,
      );
    }
  }

  async invalidateConfigCache(): Promise<void> {
    await this.redis.del(CONFIG_CACHE_KEY);
  }

  async invalidateStepsCache(planId: string): Promise<void> {
    await this.redis.del(stepsCacheKey(planId));
  }

  private async getSteps(planId: string): Promise<RoutingStepShape[]> {
    const cacheKey = stepsCacheKey(planId);
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as RoutingStepShape[];

    const rows = await this.prisma.planRoutingStep.findMany({
      where: { planId },
      orderBy: { order: 'asc' },
    });
    const steps: RoutingStepShape[] = rows.map((r) => ({
      order: r.order,
      thresholdPct: r.thresholdPct,
      models: r.models as string[],
      reasoningEffort: r.reasoningEffort ?? null,
    }));

    await this.redis.set(
      cacheKey,
      JSON.stringify(steps),
      'EX',
      STEPS_CACHE_TTL,
    );
    return steps;
  }

  private async getConfig(): Promise<RoutingConfigShape> {
    const cached = await this.redis.get(CONFIG_CACHE_KEY);
    if (cached) return JSON.parse(cached) as RoutingConfigShape;

    let row = await this.prisma.modelRoutingConfig.findFirst();
    if (!row) {
      row = await this.prisma.modelRoutingConfig.create({
        data: {
          id: SINGLETON_ID,
          simpleKeywords: DEFAULT_SIMPLE_KEYWORDS,
          complexKeywords: DEFAULT_COMPLEX_KEYWORDS,
        },
      });
    }

    const shape: RoutingConfigShape = {
      enabled: row.enabled,
      simpleKeywords: row.simpleKeywords as string[],
      complexKeywords: row.complexKeywords as string[],
      complexLenThreshold: row.complexLenThreshold,
      llmFallbackEnabled: row.llmFallbackEnabled,
      llmFallbackModel: row.llmFallbackModel,
    };

    await this.redis.set(
      CONFIG_CACHE_KEY,
      JSON.stringify(shape),
      'EX',
      CONFIG_CACHE_TTL,
    );
    return shape;
  }

  private async classify(
    input: RouteInput,
    config: RoutingConfigShape,
  ): Promise<{ tier: ModelTier; method: string; confidence: number }> {
    const heuristic = this.classifyHeuristic(
      input.content,
      config,
      input.lastAssistantMessageLength,
    );
    if (heuristic.tier !== 'ambiguous') {
      return {
        tier: heuristic.tier,
        method: heuristic.method,
        confidence: heuristic.confidence,
      };
    }

    if (config.llmFallbackEnabled) {
      const llm = await this.classifyWithLLM(
        input.content,
        config.llmFallbackModel,
        input.userId,
      );
      if (llm)
        return { tier: llm.tier, method: 'llm', confidence: llm.confidence };
    }

    // پیش‌فرض امن وقتی هم heuristic هم LLM (یا اگه غیرفعال بود) نتونستن قطعی تشخیص بدن
    return { tier: ModelTier.MEDIUM, method: 'heuristic', confidence: 0.5 };
  }

  private classifyHeuristic(
    content: string,
    config: RoutingConfigShape,
    lastAssistantMessageLength?: number,
  ): { tier: ModelTier | 'ambiguous'; method: string; confidence: number } {
    const hasCodeBlock = content.includes('```');
    const complexHits = countKeywordHits(content, config.complexKeywords);
    const simpleHits = countKeywordHits(content, config.simpleKeywords);

    // تطابق صریح با کلیدواژه‌ی ساده (مثلاً «سلام») حتی از قانون sticky هم مهم‌تره —
    // وگرنه یک سلام‌وعلیک بعد از یک جواب پیچیده به‌غلط complex حساب می‌شه و مدل گرون
    // انتخابی کاربر رو (که فقط برای MEDIUM/COMPLEX محترم شمرده می‌شه) صدا می‌زنه
    if (
      simpleHits > 0 &&
      complexHits === 0 &&
      !hasCodeBlock &&
      content.length < 150
    ) {
      return { tier: ModelTier.SIMPLE, method: 'heuristic', confidence: 0.85 };
    }

    // ثبات درون مکالمه: پیام کوتاه بلافاصله بعد از یک پاسخ بلند/پیچیده رو نباید degrade کنه
    if (
      lastAssistantMessageLength &&
      lastAssistantMessageLength > 800 &&
      content.length < 20
    ) {
      return { tier: ModelTier.COMPLEX, method: 'sticky', confidence: 0.9 };
    }

    if (content.length < 40 && complexHits === 0 && !hasCodeBlock) {
      return { tier: ModelTier.SIMPLE, method: 'heuristic', confidence: 0.85 };
    }

    if (
      hasCodeBlock ||
      complexHits >= 2 ||
      content.length > config.complexLenThreshold
    ) {
      return { tier: ModelTier.COMPLEX, method: 'heuristic', confidence: 0.8 };
    }

    return { tier: 'ambiguous', method: 'heuristic', confidence: 0 };
  }

  private async classifyWithLLM(
    content: string,
    modelId: string,
    userId: string,
  ): Promise<{ tier: ModelTier; confidence: number } | null> {
    const callStart = Date.now();
    try {
      const { object, usage } = await generateObject({
        model: this.provider(modelId),
        schema: z.object({
          tier: z.enum(['SIMPLE', 'MEDIUM', 'COMPLEX']),
          reason: z.string().max(80),
        }),
        system: `این پیام کاربر را از نظر سختی طبقه‌بندی کن.
SIMPLE: احوال‌پرسی، سوال کوتاه واقعیت‌محور، ترجمه/بازنویسی کوتاه.
MEDIUM: نوشتن متن چندبندی، توضیح مفهوم، کد کوتاه.
COMPLEX: استدلال چندمرحله‌ای، کد/معماری پیچیده، تحلیل سند بلند، درخواست صریح تفکر عمیق.
فقط یک JSON با این ساختار برگردان: {"tier": "SIMPLE" | "MEDIUM" | "COMPLEX", "reason": "..."}`,
        messages: [{ role: 'user', content: content.slice(0, 2000) }],
        // این تماس قبل از شروع پاسخ اصلی، سر راه است — نباید معطلی طولانی به
        // زمان-تا-اولین-توکن اضافه کند (docs/PERFORMANCE-AND-CONCURRENCY.md بخش ۸).
        // generateObject گزینه‌ی timeout ندارد (فقط streamText/generateText) — abortSignal معادلش است
        abortSignal: AbortSignal.timeout(8_000),
      });

      if (usage) {
        const { costToman, costUsdMicros } = await this.pricingService.calcCost(
          usage.inputTokens ?? 0,
          usage.outputTokens ?? 0,
          modelId,
        );
        this.pricingService
          .trackCost(userId, costToman, costUsdMicros)
          .catch(() => {});
      }

      this.liveStats
        .recordLiaraCall('routing', true, Date.now() - callStart)
        .catch(() => {});
      return { tier: ModelTier[object.tier], confidence: 0.75 };
    } catch (err) {
      this.liveStats
        .recordLiaraCall('routing', false, Date.now() - callStart)
        .catch(() => {});
      this.logger.warn(
        `classifier LLM call failed, falling back to MEDIUM: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private pickFromCandidates(
    candidates: AiModel[],
    desiredTier: ModelTier,
    preferredOrder?: string[],
  ): string {
    const orderIndex = (name: string): number => {
      if (!preferredOrder) return 0;
      const idx = preferredOrder.indexOf(name);
      return idx === -1 ? preferredOrder.length : idx;
    };
    const tieBreak = (a: AiModel, b: AiModel): number =>
      preferredOrder
        ? orderIndex(a.name) - orderIndex(b.name)
        : a.sortOrder - b.sortOrder;

    const exact = candidates.filter((c) => c.tier === desiredTier);
    if (exact.length) return [...exact].sort(tieBreak)[0].name;

    const sorted = [...candidates].sort((a, b) => {
      const da = Math.abs(TIER_RANK[a.tier] - TIER_RANK[desiredTier]);
      const db = Math.abs(TIER_RANK[b.tier] - TIER_RANK[desiredTier]);
      return da - db || tieBreak(a, b);
    });
    return sorted[0].name;
  }
}

function stepsCacheKey(planId: string): string {
  return `plan_routing_steps:cache:${planId}`;
}

function countKeywordHits(text: string, keywords: string[]): number {
  return keywords.reduce((n, k) => (text.includes(k) ? n + 1 : n), 0);
}
