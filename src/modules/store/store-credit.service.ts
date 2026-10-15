import { BadRequestException, Injectable } from '@nestjs/common';
import type { PaymentProvider } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { CreditsService } from '../credits/credits.service';
import { StoreService } from './store.service';
import { fa } from '../../i18n/fa';
import { estimateConversationsLeft } from './credit-estimate.util';
import { getSalesAgentGlobalConfig } from '../sales-agent/sales-agent-global-config.util';

// docs/PRD-seller-credit-billing.md بخش ۷ — خرید self-serve اعتبار AI فروشگاه از همان درگاه
// پرداخت واقعی موجود (Zarinpal/Vandar/Zibal)، با reuse کامل CreditPackage/PaymentsService
@Injectable()
export class StoreCreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
    private readonly payments: PaymentsService,
    private readonly credits: CreditsService,
  ) {}

  async getStatus(sellerId: string, storeId: string) {
    const store = await this.storeService.getOwned(sellerId, storeId);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [config, freeQuotaUsedToday, usageRows] = await Promise.all([
      getSalesAgentGlobalConfig(this.prisma),
      this.prisma.customer.count({
        where: {
          storeId,
          createdAt: { gte: todayStart },
          NOT: { sessionToken: { startsWith: 'nivo-test:' } },
        },
      }),
      // R3.4 — میانگین هزینه‌ی واقعی (کسرشده از اعتبار) هر مکالمه‌ی ۳۰ روز اخیر؛ مکالمه‌ی تستی و
      // سهمیه‌ی رایگان حساب نمی‌شوند
      this.prisma.$queryRaw<{ conversations: number; charged: number }[]>`
        SELECT COUNT(DISTINCT e."conversationId")::int AS conversations,
               COALESCE(SUM(e."chargedToman"), 0)::int AS charged
        FROM credit_usage_events e
        JOIN sales_conversations c ON c.id = e."conversationId"
        WHERE e."storeId" = ${storeId}
          AND e."createdAt" >= now() - interval '30 days'
          AND e."isFreeQuota" = false
          AND c."isTest" = false
          AND e.kind IN ('TEXT_REPLY', 'VOICE_TTS', 'ASR')
      `,
    ]);
    // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۶ — فقط وقتی واقعاً فعال است
    // (snapshot لحظه‌ی گرنت نگذشته و مانده‌اش مثبت است) به فروشنده نمایش داده شود
    const trialActive =
      !!store.trialEndsAt &&
      store.trialEndsAt > new Date() &&
      store.trialCreditRemainingToman > 0;
    return {
      balanceToman: store.creditBalanceToman,
      conversationsLeftEstimate: estimateConversationsLeft(
        store.creditBalanceToman,
        Number(usageRows[0]?.charged ?? 0),
        Number(usageRows[0]?.conversations ?? 0),
      ),
      freeQuotaUsedToday,
      freeQuotaLimit: config.freeDailyQuota,
      trialCreditRemainingToman: trialActive
        ? store.trialCreditRemainingToman
        : 0,
      trialEndsAt: trialActive ? store.trialEndsAt : null,
    };
  }

  // فیدبک کاربر ۱۴۰۵/۰۷/۰۱ — لیست بسته‌های قابل‌خرید این فروشگاه: عمومی‌ها + مخصوص همین فروشگاه
  async listPackages(sellerId: string, storeId: string) {
    await this.storeService.getOwned(sellerId, storeId);
    return this.credits.listPackages('STORE_AI_CREDIT', storeId);
  }

  async purchase(
    sellerId: string,
    storeId: string,
    packageId: string,
    gateway?: PaymentProvider,
  ) {
    const store = await this.storeService.getOwned(sellerId, storeId);
    const { pkg, priceToman } =
      await this.credits.getActivePackagePrice(packageId);
    if (pkg.scope !== 'STORE_AI_CREDIT') {
      throw new BadRequestException(fa.errors.notFound);
    }
    // بسته‌ی مخصوص یک فروشگاه دیگر نباید قابل‌خرید باشد — حتی اگر packageId را از جایی حدس بزند
    if (pkg.storeId && pkg.storeId !== storeId) {
      throw new BadRequestException(fa.errors.notFound);
    }
    const config = await this.credits.getConfig();
    return this.payments.initiateStoreCreditTopup(
      sellerId,
      store.id,
      priceToman,
      pkg.id,
      pkg.credits,
      config.tomanPerCredit,
      gateway,
    );
  }
}
