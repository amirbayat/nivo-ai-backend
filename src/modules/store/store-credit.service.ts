import { BadRequestException, Injectable } from '@nestjs/common';
import type { PaymentProvider } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { CreditsService } from '../credits/credits.service';
import { StoreService } from './store.service';
import { fa } from '../../i18n/fa';

// باید دقیقاً با FREE_DAILY_QUOTA در ../sales-agent/credit.service.ts هماهنگ بماند — اینجا
// فقط برای نمایش وضعیت به فروشنده تکرار شده (import مستقیم CreditService ممکن نیست چون
// SalesAgentModule خودش StoreModule را import می‌کند، وارد کردن برعکسش چرخه می‌سازد)
const FREE_DAILY_QUOTA = 10;

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
    const freeQuotaUsedToday = await this.prisma.customer.count({
      where: { storeId, createdAt: { gte: todayStart } },
    });
    return {
      balanceToman: store.creditBalanceToman,
      freeQuotaUsedToday,
      freeQuotaLimit: FREE_DAILY_QUOTA,
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
