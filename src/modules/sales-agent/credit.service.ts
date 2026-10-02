import { Injectable } from '@nestjs/common';
import type { BillingMode, CreditUsageKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../usage/pricing.service';

// docs/PRD-seller-credit-billing.md بخش ۱ — ۱۰ خریدار *جدید* رایگان در روز به‌ازای هر فروشگاه
// (نه ۱۰ پیام؛ واحد شمارش Customer تازه‌ساز همان روز است)
const FREE_DAILY_QUOTA = 10;

@Injectable()
export class CreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  // تک سورس عدد سهمیه‌ی رایگان روزانه — فیدبک کاربر ۱۴۰۵/۰۷/۱۲: سقف رایگان روزانه‌ی وویس هم
  // باید دقیقاً همین عدد را بخواند، نه یک ثابت جدا (conversation-engine.service.ts's
  // reserveFreeVoiceConversationSlot). وقتی فاز ۳ این عدد را از SalesAgentGlobalConfig
  // بخواند (بخش ۶.۴ سند)، این متد async می‌شود و همه‌ی مصرف‌کننده‌ها خودکار همگام می‌مانند.
  getFreeDailyQuota(): number {
    return FREE_DAILY_QUOTA;
  }

  // فقط یک‌بار، لحظه‌ی ساخت مکالمه (startChat وب / handleStart تلگرام) صدا زده می‌شود —
  // نتیجه روی SalesConversation.billingMode می‌ماند و تا آخر عمر مکالمه دوباره چک نمی‌شود
  // (docs/PRD-seller-credit-billing.md — تصمیم معماری «gate یک‌بار در شروع مکالمه»)
  async decideBillingMode(storeId: string): Promise<BillingMode> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const newCustomersToday = await this.prisma.customer.count({
      where: { storeId, createdAt: { gte: todayStart } },
    });
    if (newCustomersToday < FREE_DAILY_QUOTA) return 'FREE';

    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { creditBalanceToman: true },
    });
    return (store?.creditBalanceToman ?? 0) > 0 ? 'PAID' : 'BLOCKED';
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
    await this.prisma.creditUsageEvent.create({
      data: {
        storeId: params.storeId,
        customerId: params.customerId ?? undefined,
        conversationId: params.conversationId,
        model: params.model,
        kind: params.kind,
        costToman: params.costToman,
        isFreeQuota: params.isFreeQuota,
        tokensInput: params.tokensInput ?? 0,
        tokensOutput: params.tokensOutput ?? 0,
        costUsdMicros: params.costUsdMicros ?? 0,
      },
    });
    // decrement ساده، نه شرطی — طبق تصمیم معماری، چون هزینه‌ی واقعی فقط بعد از فراخوان
    // معلوم می‌شود؛ ممکن است balance منفی شود، که همین باعث BLOCKED شدن مکالمه‌ی بعدی است
    if (!params.isFreeQuota) {
      await this.prisma.store.update({
        where: { id: params.storeId },
        data: { creditBalanceToman: { decrement: params.costToman } },
      });
    }
  }
}
