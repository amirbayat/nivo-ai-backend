import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreditPackageScope, type CreditPackage } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../usage/pricing.service';
import { PaymentsService } from '../payments/payments.service';
import { PurchaseCreditPackageDto } from './dto/purchase-credit-package.dto';
import { ConfirmBazaarPurchaseDto } from './dto/confirm-bazaar-purchase.dto';
import { fa } from '../../i18n/fa';
import { getSalesAgentGlobalConfig } from '../sales-agent/sales-agent-global-config.util';

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

  // scope خالی یعنی GENERAL — رفتار فعلی nivo-ai-frontend (که هیچ‌وقت scope نمی‌فرسته) عیناً
  // حفظ می‌شود؛ فقط نیوو کال با scope=NIVO_CAL بسته‌های اختصاصی خودش رو می‌بینه، نه برعکس.
  // فیدبک کاربر ۱۴۰۵/۰۷/۰۱ — storeId اختیاری: فقط وقتی پاس داده شود (مسیر احراز‌هویت‌شده‌ی
  // StoreCreditService.listPackages) بسته‌های مخصوص همان فروشگاه هم کنار بسته‌های عمومی
  // دیده می‌شوند؛ بدون آن (مسیر عمومی credits-public.controller.ts) فقط بسته‌های عمومی.
  async listPackages(scope: CreditPackageScope = 'GENERAL', storeId?: string) {
    // فیدبک کاربر ۱۴۰۵/۰۷/۱۷ — فقط برای STORE_AI_CREDIT معنا دارد؛ برای GENERAL (نیوو اصلی)
    // بی‌ربط است («چت با مشتری» یک مفهوم مخصوص ایجنت فروش است)
    const [config, packages, salesAgentConfig] = await Promise.all([
      this.getConfig(),
      this.prisma.creditPackage.findMany({
        // توجه: فیلتر Prisma's `{in: [storeId, null]}` روی ستون nullable مقدار null را match
        // نمی‌کند (رفتار شناخته‌شده‌ی Prisma/SQL) — به همین دلیل OR صریح لازم است
        where: {
          isActive: true,
          scope,
          ...(storeId
            ? { OR: [{ storeId: null }, { storeId }] }
            : { storeId: null }),
        },
        orderBy: { sortOrder: 'asc' },
      }),
      scope === 'STORE_AI_CREDIT'
        ? getSalesAgentGlobalConfig(this.prisma)
        : null,
    ]);
    return packages.map((p) => {
      // docs/PRD-seller-credit-billing.md بخش ۷ — مبلغی که واقعاً به بالانس شارژ می‌شود
      // (credits × tomanPerCredit، بدون تخفیف) — برای STORE_AI_CREDIT مصرف‌کننده‌ی این فیلد
      // است تا وقتی discountPercent>0 است تفاوت «قیمت پرداختی» و «اعتبار دریافتی» را نشان دهد
      const creditToman = p.credits * config.tomanPerCredit;
      return {
        ...p,
        priceToman: this.computePackagePrice(
          p.credits,
          p.discountPercent,
          config,
        ),
        creditToman,
        ...(salesAgentConfig && {
          // صرفاً برآورد نمایشی («حدود N چت با مشتری») — در کسر واقعی اعتبار استفاده نمی‌شود
          estimatedChats: Math.round(
            creditToman / salesAgentConfig.avgCostPerChatToman,
          ),
        }),
      };
    });
  }

  // برای کارت «مبلغ دلخواه» — همون فرمول computePackagePrice زیر رو با discountPercent بسته‌ی
  // isCustomAmount واقعی حساب می‌کنه، تا فرانت (با debounce) قیمت زنده نشون بده بدون این‌که
  // purchaseMarkup/فرمول قیمت‌گذاری رو خودش duplicate کنه (docs/PRD-discovery-and-credits.md)
  async quoteCustomPrice(
    credits: number,
    scope: CreditPackageScope = 'GENERAL',
  ): Promise<{ priceToman: number }> {
    const safeCredits =
      Number.isFinite(credits) && credits > 0 ? Math.floor(credits) : 0;
    const [config, customPkg] = await Promise.all([
      this.getConfig(),
      this.prisma.creditPackage.findFirst({
        where: { isCustomAmount: true, isActive: true, scope },
      }),
    ]);
    const priceToman = this.computePackagePrice(
      safeCredits,
      customPkg?.discountPercent ?? 0,
      config,
    );
    return { priceToman };
  }

  // قیمت نهایی بسته: credits × tomanPerCredit × (1 - discountPercent/100) — بدون مارک‌آپ.
  // هر نیوو دقیقاً tomanPerCredit تومان است؛ مارک‌آپ فقط لحظه‌ی مصرف (debitWallet) اعمال می‌شود،
  // نه این‌جا — چون کیف‌پول بعد از خرید باید دقیقاً معادل همان تعداد نیووی روی برچسب بسته شارژ شود.
  private computePackagePrice(
    credits: number,
    discountPercent: number,
    config: { tomanPerCredit: number },
  ): number {
    const base = credits * config.tomanPerCredit;
    return Math.round(base * (1 - discountPercent / 100));
  }

  // docs/PRD-seller-credit-billing.md بخش ۷ — reuse شده توسط StoreCreditService (خرید اعتبار
  // AI فروشگاه)؛ برخلاف purchasePackage زیر، مبلغ دلخواه (isCustomAmount) پشتیبانی نمی‌شود —
  // بسته‌های STORE_AI_CREDIT فعلاً فقط بسته‌ی ثابت
  async getActivePackagePrice(
    packageId: string,
  ): Promise<{ pkg: CreditPackage; priceToman: number }> {
    const config = await this.getConfig();
    const pkg = await this.prisma.creditPackage.findUnique({
      where: { id: packageId },
    });
    if (!pkg || !pkg.isActive) throw new NotFoundException(fa.errors.notFound);
    const priceToman = this.computePackagePrice(
      pkg.credits,
      pkg.discountPercent,
      config,
    );
    return { pkg, priceToman };
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
    // چیزی جدید در مسیر پرداخت لازم نیست. packageId/effectiveCredits فقط برای گزارش‌های ادمین
    // پاس داده می‌شوند (docs/PRD-admin-credit-reports.md بخش ۲) — روی رفتار پرداخت/کیف‌پول اثری ندارند.
    return this.payments.initiateCreditTopup(
      userId,
      amountToman,
      dto.gateway,
      dto.source,
      pkg.id,
      effectiveCredits,
      dto.returnUrl,
      config.tomanPerCredit,
    );
  }

  // تایید یک خرید که سمت کلاینت (اپ اندروید نیوو کال، SDK پولکی کافه‌بازار) از قبل کامل شده —
  // فقط بسته‌های ثابت با bazaarSku ست‌شده (docs/PRD-nivo-cal-credits-ui.md بخش ۴). برخلاف
  // purchasePackage بالا، هیچ paymentUrl/redirect ای برنمی‌گرداند؛ فقط بالانس تازه را.
  async confirmBazaarPurchase(userId: string, dto: ConfirmBazaarPurchaseDto) {
    const config = await this.getConfig();
    const pkg = await this.prisma.creditPackage.findUnique({
      where: { id: dto.packageId },
    });
    if (!pkg || !pkg.isActive) throw new NotFoundException(fa.errors.notFound);
    if (pkg.isCustomAmount || !pkg.bazaarSku) {
      throw new BadRequestException(fa.payment.bazaarPackageNotSupported);
    }

    const amountToman = this.computePackagePrice(
      pkg.credits,
      pkg.discountPercent,
      config,
    );

    await this.payments.confirmBazaarPurchase(
      userId,
      pkg,
      amountToman,
      dto.purchaseToken,
      config.tomanPerCredit,
    );

    return this.getBalance(userId);
  }
}
