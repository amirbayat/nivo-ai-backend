import { Injectable } from '@nestjs/common';
import type { BillingMode, CreditUsageKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../usage/pricing.service';
import { getSalesAgentGlobalConfig } from './sales-agent-global-config.util';
import { CreditAlertService } from './credit-alert.service';
import { StoreCreditDeductionService } from '../store-credit-engine/store-credit-deduction.service';

@Injectable()
export class CreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly deduction: StoreCreditDeductionService,
    private readonly alerts: CreditAlertService,
  ) {}

  // تک سورس عدد سهمیه‌ی رایگان روزانه — فیدبک کاربر ۱۴۰۵/۰۷/۱۲: سقف رایگان روزانه‌ی وویس هم
  // باید دقیقاً همین عدد را بخواند، نه یک ثابت جدا (conversation-engine.service.ts's
  // reserveFreeVoiceConversationSlot). بخش ۶.۴ سند — از SalesAgentGlobalConfig خوانده می‌شود
  // (کش‌شده ۶۰ ثانیه)، نه یک ثابت هاردکد.
  async getFreeDailyQuota(): Promise<number> {
    const config = await getSalesAgentGlobalConfig(this.prisma);
    return config.freeDailyQuota;
  }

  // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۶.۳ — فقط یک‌بار، لحظه‌ی اولین
  // چتِ اولین خریدار هر فروشگاه (یعنی اولین‌بار که یک Customer برای این storeId ساخته می‌شود)؛
  // trialStartedAt null بودن همان شرط «اولین‌بار» است، نیازی به کوئری شمارش جدا نیست
  async grantTrialIfFirstChat(storeId: string): Promise<void> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { trialStartedAt: true },
    });
    if (!store || store.trialStartedAt) return;
    const config = await getSalesAgentGlobalConfig(this.prisma);
    const now = new Date();
    const trialEndsAt = new Date(
      now.getTime() + config.trialDurationDays * 24 * 60 * 60 * 1000,
    );
    await this.prisma.store.update({
      where: { id: storeId },
      data: {
        trialStartedAt: now,
        trialEndsAt,
        trialCreditRemainingToman: config.trialCreditToman,
      },
    });
  }

  // فقط یک‌بار، لحظه‌ی ساخت مکالمه (startChat وب / handleStart تلگرام) صدا زده می‌شود —
  // نتیجه روی SalesConversation.billingMode می‌ماند و تا آخر عمر مکالمه دوباره چک نمی‌شود
  // (docs/PRD-seller-credit-billing.md — تصمیم معماری «gate یک‌بار در شروع مکالمه»)
  //
  // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۶.۷ (اصلاح ۱۴۰۵/۰۷/۱۷) — سهمیه‌ی
  // رایگان روزانه (FREE_DAILY_QUOTA) حذف شد؛ دیگر هرگز 'FREE' برنمی‌گرداند. هر مکالمه از همان
  // پیام اول از اعتبار آزمایشی/واقعی فروشگاه کم می‌شود.
  async decideBillingMode(storeId: string): Promise<BillingMode> {
    // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۶.۴ — PAID یعنی بودجه‌ی
    // آزمایشی هنوز فعال است (trialEndsAt نگذشته و مانده‌اش مثبت است) یا اعتبار واقعی دارد
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        creditBalanceToman: true,
        trialEndsAt: true,
        trialCreditRemainingToman: true,
      },
    });
    if (!store) return 'BLOCKED';
    const trialActive =
      !!store.trialEndsAt &&
      store.trialEndsAt > new Date() &&
      store.trialCreditRemainingToman > 0;
    return trialActive || store.creditBalanceToman > 0 ? 'PAID' : 'BLOCKED';
  }

  // مصرف متن (parseIntent/caption/tryAnswerFromProductDescriptions) — هزینه از
  // PricingService.calcCost (همان زیرساخت قیمت‌گذاری واقعی چت اصلی) محاسبه می‌شود
  async logTextUsage(params: {
    storeId: string;
    customerId: string | null;
    conversationId: string;
    billingMode: BillingMode;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }): Promise<void> {
    if (params.billingMode === 'BLOCKED') return; // safety net — نباید اصلاً به اینجا برسد
    const { costToman, costUsdMicros } = await this.pricing.calcCost(
      params.inputTokens,
      params.outputTokens,
      params.model,
    );
    await this.logUsage({
      storeId: params.storeId,
      customerId: params.customerId,
      conversationId: params.conversationId,
      model: params.model,
      kind: 'TEXT_REPLY',
      costToman,
      isFreeQuota: params.billingMode === 'FREE',
      tokensInput: params.inputTokens,
      tokensOutput: params.outputTokens,
      costUsdMicros,
    });
  }

  // مصرف وویس (sales-agent-voice.processor.ts) — هزینه از دلار واقعی kie.ai
  // (creditsConsumed × KIE_USD_PER_CREDIT، همان نرخ استفاده‌شده در video-edit.processor.ts)
  // به تومان تبدیل می‌شود
  async logVoiceUsage(params: {
    storeId: string;
    customerId: string | null;
    conversationId: string;
    billingMode: BillingMode;
    model: string;
    usdCost: number;
  }): Promise<void> {
    if (params.billingMode === 'BLOCKED') return;
    const { costToman, costUsdMicros } = await this.pricing.calcFlatCostToman(
      params.usdCost,
    );
    await this.logUsage({
      storeId: params.storeId,
      customerId: params.customerId,
      conversationId: params.conversationId,
      model: params.model,
      kind: 'VOICE_TTS',
      costToman,
      isFreeQuota: params.billingMode === 'FREE',
      costUsdMicros,
    });
  }

  // فیدبک کاربر ۱۴۰۵/۰۷/۱۸ — مصرف ASR (تبدیل صدای مشتری به متن، sales-agent.service.ts
  // submitVoiceMessage و telegram.service.ts handleVoice) قبلاً اصلاً لاگ/کسر نمی‌شد با وجود
  // اینکه transcript.costUsd واقعی از OpenRouter برمی‌گشت — enum از قبل مقدار ASR را داشت
  // ولی هیچ کد وصل‌کننده‌ای نوشته نشده بود. الگو دقیقاً مثل logVoiceUsage (هزینه‌ی دلاری flat)
  async logAsrUsage(params: {
    storeId: string;
    customerId: string | null;
    conversationId: string;
    billingMode: BillingMode;
    model: string;
    usdCost: number;
  }): Promise<void> {
    if (params.billingMode === 'BLOCKED') return;
    if (params.usdCost <= 0) return;
    const { costToman, costUsdMicros } = await this.pricing.calcFlatCostToman(
      params.usdCost,
    );
    await this.logUsage({
      storeId: params.storeId,
      customerId: params.customerId,
      conversationId: params.conversationId,
      model: params.model,
      kind: 'ASR',
      costToman,
      isFreeQuota: params.billingMode === 'FREE',
      costUsdMicros,
    });
  }

  // 1.2 — کسر (و ثبت CreditUsageEvent) کاملاً در StoreCreditDeductionService: یک تراکنش با قفل
  // ردیف فروشگاه، ضریب به‌ازای منبع بخش، آزمایشی تا حد موجودی‌اش. costToman خام (COGS) بدون تغییر
  // لاگ می‌شود تا حسابداری ادمین (StoresPage) همچنان COGS واقعی را ببیند.
  private async logUsage(params: {
    storeId: string;
    customerId: string | null;
    conversationId: string;
    model: string;
    kind: CreditUsageKind;
    costToman: number;
    isFreeQuota: boolean;
    tokensInput?: number;
    tokensOutput?: number;
    costUsdMicros?: number;
  }): Promise<void> {
    const result = await this.deduction.deductSafely({
      storeId: params.storeId,
      rawCostToman: params.costToman,
      kind: 'BUYER',
      isFreeQuota: params.isFreeQuota,
      event: {
        model: params.model,
        kind: params.kind,
        customerId: params.customerId,
        conversationId: params.conversationId,
        tokensInput: params.tokensInput,
        tokensOutput: params.tokensOutput,
        costUsdMicros: params.costUsdMicros,
      },
    });
    // 1.5 — هشدار «رو به اتمام» (ارزان؛ بدون await روی مسیر پاسخ به خریدار)
    if (result?.spendableAfter != null) {
      void this.alerts.checkLow(params.storeId, result.spendableAfter);
    }
  }

  // 1.2(۱) — رزرو/آزادسازی یک turn (کف overdraft با رزرو هم‌زمانی)
  reserveTurn(storeId: string): Promise<boolean> {
    return this.deduction.reserveTurn(storeId);
  }
  releaseTurn(storeId: string): Promise<void> {
    return this.deduction.releaseTurn(storeId);
  }

  // 1.2(۱) — قبل از هر turn AI/TTS/ASR: زیر کف overdraft ← false
  async canSpend(storeId: string): Promise<boolean> {
    return this.deduction.canSpend(storeId);
  }
}
