import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../usage/pricing.service';
import { PaymentsService } from '../payments/payments.service';
import { PurchaseCreditPackageDto } from './dto/purchase-credit-package.dto';
import { fa } from '../../i18n/fa';

// «نیوو» یک ارز/جدول جدید نیست — واحد نمایشی روی همان Wallet.balanceToman موجود است
// (docs/PRD-discovery-and-credits.md بخش ۳). این سرویس فقط لایه‌ی نازک تبدیل/نمایش +
// خرید بسته را اضافه می‌کند؛ کسر واقعی همچنان از PricingService.debitWallet رد می‌شود.
@Injectable()
export class CreditsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly payments: PaymentsService,
  ) {}

  async getConfig() {
    return this.prisma.creditConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });
  }

  // موجودی نیوو = balanceToman / tomanPerCredit — گرد به پایین تا هیچ‌وقت اعتباری که کاربر
  // ندارد نمایش داده نشود (بخش ۳ — نیوو فقط واحد نمایشی است، نه ledger جدا)
  async getBalance(userId: string) {
    const [config, balanceToman] = await Promise.all([
      this.getConfig(),
      this.pricing.getWalletBalance(userId),
    ]);
    return {
      credits: Math.floor(balanceToman / config.tomanPerCredit),
      balanceToman,
      tomanPerCredit: config.tomanPerCredit,
    };
  }

  async listPackages() {
    const [config, packages] = await Promise.all([
      this.getConfig(),
      this.prisma.creditPackage.findMany({
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    return packages.map((p) => ({
      ...p,
      priceToman: this.computePackagePrice(
        p.credits,
        p.discountPercent,
        config,
      ),
    }));
  }

  // برای کارت «مبلغ دلخواه» — همون فرمول computePackagePrice زیر رو با discountPercent بسته‌ی
  // isCustomAmount واقعی حساب می‌کنه، تا فرانت (با debounce) قیمت زنده نشون بده بدون این‌که
  // purchaseMarkup/فرمول قیمت‌گذاری رو خودش duplicate کنه (docs/PRD-discovery-and-credits.md)
  async quoteCustomPrice(credits: number): Promise<{ priceToman: number }> {
    const safeCredits =
      Number.isFinite(credits) && credits > 0 ? Math.floor(credits) : 0;
    const [config, customPkg] = await Promise.all([
      this.getConfig(),
      this.prisma.creditPackage.findFirst({
        where: { isCustomAmount: true, isActive: true },
      }),
    ]);
    const priceToman = this.computePackagePrice(
      safeCredits,
      customPkg?.discountPercent ?? 0,
      config,
    );
    return { priceToman };
  }

  // قیمت نهایی بسته: credits × tomanPerCredit × purchaseMarkup × (1 - discountPercent/100)
  // ضریب ۱.۳ اینجا (لحظه‌ی خرید) اعمال می‌شود، نه لحظه‌ی مصرف — چون هزینه‌ی هر سبک از قبل ثابت است
  private computePackagePrice(
    credits: number,
    discountPercent: number,
    config: { tomanPerCredit: number; purchaseMarkup: number },
  ): number {
    const base = credits * config.tomanPerCredit * config.purchaseMarkup;
    return Math.round(base * (1 - discountPercent / 100));
  }

  async purchasePackage(userId: string, dto: PurchaseCreditPackageDto) {
    const config = await this.getConfig();
    const pkg = await this.prisma.creditPackage.findUnique({
      where: { id: dto.packageId },
    });
    if (!pkg || !pkg.isActive) throw new NotFoundException(fa.errors.notFound);

    // کارت «مبلغ دلخواه» — credits این بسته یعنی حداقل مجاز؛ کاربر عدد واقعی را در customCredits می‌فرستد
    let effectiveCredits = pkg.credits;
    if (pkg.isCustomAmount) {
      if (!dto.customCredits || dto.customCredits < pkg.credits) {
        throw new BadRequestException(
          fa.discovery.customAmountBelowMinimum(pkg.credits),
        );
      }
      effectiveCredits = dto.customCredits;
    }

    const amountToman = this.computePackagePrice(
      effectiveCredits,
      pkg.discountPercent,
      config,
    );
    if (amountToman <= 0)
      throw new BadRequestException(fa.validation.numberPositive);

    // initiateCreditTopup — مستقل از Plan/isPayAsYouGo (برخلاف initiateWalletTopup قدیمی)؛
    // حداقل مبلغ خودش همین بالاتر با pkg.credits چک شده، نه یک سقف تومانی جدا از Plan.
    // بعد از تکمیل پرداخت، همان کد callback موجود Wallet.balanceToman را افزایش می‌دهد؛
    // چیزی جدید در مسیر پرداخت لازم نیست.
    return this.payments.initiateCreditTopup(
      userId,
      amountToman,
      dto.gateway,
    );
  }
}
