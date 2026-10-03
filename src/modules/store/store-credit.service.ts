import { BadRequestException, Injectable } from '@nestjs/common';
import type { PaymentProvider } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { CreditsService } from '../credits/credits.service';
import { StoreService } from './store.service';
import { fa } from '../../i18n/fa';
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
    const [config, freeQuotaUsedToday] = await Promise.all([
      getSalesAgentGlobalConfig(this.prisma),
      this.prisma.customer.count({
        where: { storeId, createdAt: { gte: todayStart } },
      }),
    ]);
    // docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۶ — فقط وقتی واقعاً فعال است
    // (snapshot لحظه‌ی گرنت نگذشته و مانده‌اش مثبت است) به فروشنده نمایش داده شود
    const trialActive =
      !!store.trialEndsAt &&
      store.trialEndsAt > new Date() &&
      store.trialCreditRemainingToman > 0;
    return {
      balanceToman: store.creditBalanceToman,
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
