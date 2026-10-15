import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  type CreditSource,
  type CreditUsageKind,
  type PaymentProvider,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  OVERDRAFT_FLOOR_TOMAN,
  STORE_BALANCE_CACHE_TTL_SECONDS,
  TURN_COST_ESTIMATE_TOMAN,
  TURN_RESERVATION_TTL_SECONDS,
} from '../../common/constants/sales-ops.constants';
import { getSalesAgentGlobalConfig } from '../sales-agent/sales-agent-global-config.util';
import {
  planDeduction,
  planFixedPriceDebit,
  type BucketCharge,
  type PlanBucket,
} from './credit-deduction.planner';

type Tx = Prisma.TransactionClient;

export type DeductKind = 'BUYER' | 'SELLER';

export interface ChargeBreakdownEntry {
  source: CreditSource | 'TRIAL';
  chargedToman: number;
  markup: number;
}

export interface DeductParams {
  storeId: string;
  // هزینه‌ی خام AI (COGS)، بدون ضریب
  rawCostToman: number;
  kind: DeductKind;
  event: {
    model: string;
    kind: CreditUsageKind;
    customerId?: string | null;
    conversationId?: string | null;
    isTest?: boolean;
    tokensInput?: number;
    tokensOutput?: number;
    costUsdMicros?: number;
  };
  // سهمیه‌ی رایگان: فقط رویداد ثبت می‌شود، موجودی کم نمی‌شود
  isFreeQuota?: boolean;
}

export interface DeductResult {
  chargedToman: number;
  breakdown: ChargeBreakdownEntry[];
  // موجودی قابل‌خرج بعد از کسر (آزمایشیِ فعال + creditBalanceToman) — برای هشدار اعتبار
  spendableAfter: number | null;
}

interface LockedStore {
  id: string;
  creditBalanceToman: number;
  trialEndsAt: Date | null;
  trialCreditRemainingToman: number;
}

// نگاشت یک‌به‌یک PaymentProvider → CreditSource (مشخصات ج ۲۳.۱)
export function providerToCreditSource(
  provider: PaymentProvider,
): CreditSource {
  return provider;
}

const FALLBACK_SOURCE: CreditSource = 'LEGACY';

// قفل ردیف فروشگاه ممکن است پشت چند کسر هم‌زمان صف بکشد؛ پیش‌فرض ۵ثانیه‌ی Prisma کم است
const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 };

// فاز ۱ (1.2، مشخصات ج ۲۳.۳) — تنها جایی که اعتبار فروشگاه کم/زیاد می‌شود. جای سه کپی قبلی
// (credit.service logUsage، store-kb، guide-assistant) و خرید جایگاه تبلیغاتی و شارژ پرداخت.
// هر عملیات در یک تراکنش interactive با قفل ردیف فروشگاه (SELECT … FOR UPDATE) اجرا می‌شود؛
// ناوردایی Store.creditBalanceToman = Σ StoreCreditBucket.balanceToman را حفظ می‌کند.
@Injectable()
export class StoreCreditDeductionService {
  private readonly logger = new Logger(StoreCreditDeductionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ───────────────────────── کسر مصرف AI ─────────────────────────
  async deduct(params: DeductParams): Promise<DeductResult> {
    const { storeId, rawCostToman, kind } = params;

    if (params.isFreeQuota) {
      await this.prisma.creditUsageEvent.create({
        data: this.eventData(params, 0, []),
      });
      return { chargedToman: 0, breakdown: [], spendableAfter: null };
    }

    const [config, markupRows] = await Promise.all([
      getSalesAgentGlobalConfig(this.prisma),
      this.prisma.creditSourceMarkup.findMany(),
    ]);
    const globalMarkup =
      kind === 'BUYER' ? config.buyerCostMarkup : config.sellerCostMarkup;
    const markupFor = (source: CreditSource): number => {
      const row = markupRows.find((r) => r.source === source);
      const own = kind === 'BUYER' ? row?.buyerMarkup : row?.sellerMarkup;
      return own ?? globalMarkup;
    };

    const result = await this.prisma.$transaction(async (tx) => {
      const store = await this.lockStore(tx, storeId);
      const buckets = await this.loadHealedBuckets(tx, store);

      const trialActive =
        !!store.trialEndsAt &&
        store.trialEndsAt > new Date() &&
        store.trialCreditRemainingToman > 0;
      const plan = planDeduction({
        rawCostToman,
        trial: {
          active: trialActive,
          remainingToman: store.trialCreditRemainingToman,
          // آزمایشی همیشه با ضرایب سراسری (بودجه‌ی هدیه، منبع ندارد)
          markup: globalMarkup,
        },
        buckets: buckets.map((b) => ({
          source: b.source,
          balanceToman: b.balanceToman,
          markup: markupFor(b.source),
        })),
        overflowFallback: {
          source: FALLBACK_SOURCE,
          markup: markupFor(FALLBACK_SOURCE),
        },
      });

      const bucketTotal = plan.bucketCharges.reduce(
        (sum, c) => sum + c.chargedToman,
        0,
      );
      for (const charge of plan.bucketCharges) {
        await this.applyBucketDelta(
          tx,
          storeId,
          charge.source,
          -charge.chargedToman,
        );
      }
      if (bucketTotal > 0 || plan.trialChargedToman > 0) {
        await tx.store.update({
          where: { id: storeId },
          data: {
            ...(bucketTotal > 0
              ? { creditBalanceToman: { decrement: bucketTotal } }
              : {}),
            ...(plan.trialChargedToman > 0
              ? {
                  trialCreditRemainingToman: {
                    decrement: plan.trialChargedToman,
                  },
                }
              : {}),
          },
        });
      }

      const breakdown: ChargeBreakdownEntry[] = [
        ...(plan.trialChargedToman > 0
          ? [
              {
                source: 'TRIAL' as const,
                chargedToman: plan.trialChargedToman,
                markup: plan.trialMarkup,
              },
            ]
          : []),
        ...plan.bucketCharges,
      ];
      await tx.creditUsageEvent.create({
        data: this.eventData(params, plan.chargedToman, breakdown),
      });

      const spendableAfter =
        store.creditBalanceToman -
        bucketTotal +
        (trialActive
          ? store.trialCreditRemainingToman - plan.trialChargedToman
          : 0);
      return { chargedToman: plan.chargedToman, breakdown, spendableAfter };
    }, TX_OPTIONS);

    await this.cacheSpendable(storeId, result.spendableAfter);
    return {
      chargedToman: result.chargedToman,
      breakdown: result.breakdown,
      spendableAfter: result.spendableAfter,
    };
  }

  // برای مصرف‌هایی که خروجی‌شان قبلاً به کاربر داده شده (فروشنده‌ی داخل پنل، ASR، TTS): شکست
  // کسر نباید نتیجه را به خطا تبدیل کند یا فراخوان مدل را دوباره راه بیندازد؛ فقط لاگ می‌شود
  async deductSafely(params: DeductParams): Promise<DeductResult | null> {
    try {
      return await this.deduct(params);
    } catch (err) {
      this.logger.error(
        `credit deduction failed (store=${params.storeId}, kind=${params.event.kind}, model=${params.event.model}, raw=${params.rawCostToman})`,
        err as Error,
      );
      return null;
    }
  }

  private eventData(
    params: DeductParams,
    chargedToman: number,
    breakdown: ChargeBreakdownEntry[],
  ): Prisma.CreditUsageEventUncheckedCreateInput {
    const { event } = params;
    return {
      storeId: params.storeId,
      customerId: event.customerId ?? undefined,
      conversationId: event.conversationId ?? undefined,
      model: event.model,
      kind: event.kind,
      costToman: params.rawCostToman,
      chargedToman,
      isFreeQuota: !!params.isFreeQuota,
      tokensInput: event.tokensInput ?? 0,
      tokensOutput: event.tokensOutput ?? 0,
      costUsdMicros: event.costUsdMicros ?? 0,
      chargeBreakdown:
        breakdown.length > 0
          ? (breakdown as unknown as Prisma.InputJsonValue)
          : undefined,
      ...(event.isTest ? { meta: { isTest: true } } : {}),
    };
  }

  // ───────────────────────── شارژ (پرداخت موفق) ─────────────────────────
  // داخل تراکنش پرداخت (ایدمپوتنسی همان پرداخت): بخش منبع را افزایش می‌دهد و ناوردایی را نگه می‌دارد
  async applyTopup(
    tx: Tx,
    params: { storeId: string; source: CreditSource; amountToman: number },
  ): Promise<void> {
    const store = await this.lockStore(tx, params.storeId);
    await this.loadHealedBuckets(tx, store);
    await this.applyBucketDelta(
      tx,
      params.storeId,
      params.source,
      params.amountToman,
    );
    await tx.store.update({
      where: { id: params.storeId },
      data: { creditBalanceToman: { increment: params.amountToman } },
    });
    // کش باید بعد از commit پاک شود؛ ولی TTL کوتاه است و caller بعد از تراکنش invalidate می‌کند
  }

  // ───────────────────────── کسر دستی ادمین (R1.1) ─────────────────────────
  // داخل تراکنش caller. از بخش‌های مثبت کسر می‌کند و باقی را روی ADMIN_MANUAL (می‌تواند منفی شود)؛
  // null = موجودی بعد از کسر زیر کف overdraft می‌رفت (هیچ تغییری نمی‌دهد). ناوردایی حفظ می‌شود.
  async applyAdminDebit(
    tx: Tx,
    params: { storeId: string; amountToman: number },
  ): Promise<{ beforeToman: number; afterToman: number } | null> {
    const store = await this.lockStore(tx, params.storeId);
    const buckets = await this.loadHealedBuckets(tx, store);
    const before = buckets.reduce((s, b) => s + b.balanceToman, 0);
    const after = before - params.amountToman;
    if (after < -OVERDRAFT_FLOOR_TOMAN) return null;
    let remaining = params.amountToman;
    for (const b of [...buckets].sort((a, c) => c.balanceToman - a.balanceToman)) {
      if (remaining <= 0 || b.balanceToman <= 0) continue;
      const take = Math.min(b.balanceToman, remaining);
      await this.applyBucketDelta(tx, params.storeId, b.source, -take);
      remaining -= take;
    }
    if (remaining > 0) {
      await this.applyBucketDelta(tx, params.storeId, 'ADMIN_MANUAL', -remaining);
    }
    await tx.store.update({
      where: { id: params.storeId },
      data: { creditBalanceToman: { decrement: params.amountToman } },
    });
    return { beforeToman: before, afterToman: after };
  }

  // ───────────────────────── خرید ثابت‌مبلغ (جایگاه تبلیغاتی) ─────────────────────────
  // داخل تراکنش خرید؛ null = موجودی (موثر) کافی نیست (overdraft ندارد)، وگرنه مبلغی که واقعاً
  // از بخش‌ها کم شد (برای بخش‌های گران‌تر مثل اسنپ‌پی از قیمت بیشتر است).
  async debitFixedPrice(
    tx: Tx,
    params: { storeId: string; priceToman: number },
  ): Promise<number | null> {
    const config = await getSalesAgentGlobalConfig(this.prisma);
    const markupRows = await this.prisma.creditSourceMarkup.findMany();
    const markupFor = (source: CreditSource) =>
      markupRows.find((r) => r.source === source)?.buyerMarkup ??
      config.buyerCostMarkup;

    const store = await this.lockStore(tx, params.storeId);
    const buckets = await this.loadHealedBuckets(tx, store);
    const charges = planFixedPriceDebit({
      priceToman: params.priceToman,
      globalMarkup: config.buyerCostMarkup,
      buckets: buckets.map((b) => ({
        source: b.source,
        balanceToman: b.balanceToman,
        markup: markupFor(b.source),
      })),
    });
    if (!charges) return null;
    const total = charges.reduce((sum, c) => sum + c.chargedToman, 0);
    for (const c of charges) {
      await this.applyBucketDelta(
        tx,
        params.storeId,
        c.source,
        -c.chargedToman,
      );
    }
    await tx.store.update({
      where: { id: params.storeId },
      data: { creditBalanceToman: { decrement: total } },
    });
    return total;
  }

  // ───────────────────────── canSpend (کف overdraft) ─────────────────────────
  private cacheKey(storeId: string) {
    return `store:bal:${storeId}`;
  }

  private async cacheSpendable(storeId: string, spendable: number) {
    try {
      await this.redis.set(
        this.cacheKey(storeId),
        String(spendable),
        'EX',
        STORE_BALANCE_CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(`balance cache write failed: ${(err as Error).message}`);
    }
  }

  async invalidateBalanceCache(storeId: string): Promise<void> {
    try {
      await this.redis.del(this.cacheKey(storeId));
    } catch (err) {
      this.logger.warn(
        `balance cache delete failed: ${(err as Error).message}`,
      );
    }
  }

  // موجودی قابل‌خرج = (آزمایشیِ فعال) + creditBalanceToman؛ می‌تواند منفی باشد
  async getSpendable(storeId: string): Promise<number | null> {
    try {
      const cached = await this.redis.get(this.cacheKey(storeId));
      if (cached !== null) return Number(cached);
    } catch (err) {
      this.logger.warn(`balance cache read failed: ${(err as Error).message}`);
    }
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        creditBalanceToman: true,
        trialEndsAt: true,
        trialCreditRemainingToman: true,
      },
    });
    if (!store) return null;
    const trialActive =
      !!store.trialEndsAt &&
      store.trialEndsAt > new Date() &&
      store.trialCreditRemainingToman > 0;
    const spendable =
      store.creditBalanceToman +
      (trialActive ? store.trialCreditRemainingToman : 0);
    await this.cacheSpendable(storeId, spendable);
    return spendable;
  }

  // قبل از هر turn AI (و TTS/ASR): زیر کف overdraft ← false (handoff «فروشنده شخصاً جواب می‌دهد»)
  async canSpend(storeId: string): Promise<boolean> {
    const spendable = await this.getSpendable(storeId);
    if (spendable === null) return false;
    return spendable > -OVERDRAFT_FLOOR_TOMAN;
  }

  // رزرو یک turn: (موجودی قابل‌خرج − مجموع رزروهای در حال اجرا − برآورد این turn) باید بالای
  // −کف بماند. بدون رزرو، N مکالمه‌ی هم‌زمان همه با موجودی صفر از canSpend عبور می‌کردند و
  // مجموع مصرف از کف می‌گذشت. بعد از turn باید releaseTurn صدا زده شود (در finally).
  async reserveTurn(storeId: string): Promise<boolean> {
    const spendable = await this.getSpendable(storeId);
    if (spendable === null) return false;
    const key = `store:resv:${storeId}`;
    let reservedTotal: number;
    try {
      reservedTotal = await this.redis.incrby(key, TURN_COST_ESTIMATE_TOMAN);
      await this.redis.expire(key, TURN_RESERVATION_TTL_SECONDS);
    } catch (err) {
      // Redis مشکل دارد → به canSpend ساده برگرد (بدون رزرو)
      this.logger.warn(`turn reservation failed: ${(err as Error).message}`);
      return spendable > -OVERDRAFT_FLOOR_TOMAN;
    }
    if (spendable - reservedTotal <= -OVERDRAFT_FLOOR_TOMAN) {
      await this.releaseTurn(storeId);
      return false;
    }
    return true;
  }

  async releaseTurn(storeId: string): Promise<void> {
    const key = `store:resv:${storeId}`;
    try {
      const left = await this.redis.decrby(key, TURN_COST_ESTIMATE_TOMAN);
      if (left < 0) await this.redis.del(key);
    } catch (err) {
      this.logger.warn(`turn release failed: ${(err as Error).message}`);
    }
  }

  // ───────────────────────── 1.3 بازارزیابی BLOCKED ─────────────────────────
  // بعد از شارژ موفق و در unmute: مکالمات BLOCKED فروشگاه که حالا موجودی مثبت (مثل
  // decideBillingMode: آزمایشیِ فعال یا اعتبار > ۰) دارند دوباره PAID می‌شوند؛ وگرنه «برگشت به
  // بات» دوباره handoff و هشدار تکراری می‌داد. تعداد مکالمات به‌روزشده را برمی‌گرداند.
  async reevaluateBlockedConversations(storeId: string): Promise<number> {
    await this.invalidateBalanceCache(storeId);
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: {
        creditBalanceToman: true,
        trialEndsAt: true,
        trialCreditRemainingToman: true,
      },
    });
    if (!store) return 0;
    const trialActive =
      !!store.trialEndsAt &&
      store.trialEndsAt > new Date() &&
      store.trialCreditRemainingToman > 0;
    if (!(store.creditBalanceToman > 0 || trialActive)) return 0;
    const res = await this.prisma.salesConversation.updateMany({
      where: { storeId, billingMode: 'BLOCKED' },
      data: { billingMode: 'PAID' },
    });
    return res.count;
  }

  // ───────────────────────── ناوردایی ─────────────────────────
  // فروشگاه‌هایی که creditBalanceToman ≠ Σ بخش‌ها (برای job/endpoint تطبیق، فقط‌خواندنی)
  async findInvariantViolations(
    limit = 100,
  ): Promise<
    { storeId: string; creditBalanceToman: number; bucketsSumToman: number }[]
  > {
    const rows = await this.prisma.$queryRaw<
      { storeId: string; creditBalanceToman: number; bucketsSumToman: number }[]
    >`
      SELECT s."id" AS "storeId", s."creditBalanceToman",
             COALESCE(SUM(b."balanceToman"), 0)::int AS "bucketsSumToman"
      FROM "stores" s
      LEFT JOIN "store_credit_buckets" b ON b."storeId" = s."id"
      GROUP BY s."id", s."creditBalanceToman"
      HAVING s."creditBalanceToman" <> COALESCE(SUM(b."balanceToman"), 0)
      LIMIT ${limit}`;
    return rows;
  }

  // ───────────────────────── داخلی ─────────────────────────
  private async lockStore(tx: Tx, storeId: string): Promise<LockedStore> {
    const rows = await tx.$queryRaw<LockedStore[]>`
      SELECT "id", "creditBalanceToman", "trialEndsAt", "trialCreditRemainingToman"
      FROM "stores" WHERE "id" = ${storeId} FOR UPDATE`;
    if (rows.length === 0) throw new Error(`store ${storeId} not found`);
    return rows[0];
  }

  // بخش‌ها را می‌خواند؛ اگر ناوردایی به‌هم خورده (مثلاً کد قدیمی در پنجره‌ی دیپلوی فقط
  // creditBalanceToman را عوض کرده، یا SQL backfill هنوز اجرا نشده) اختلاف را در LEGACY ترمیم
  // می‌کند. زیر همان قفل ردیف است، پس امن است.
  private async loadHealedBuckets(tx: Tx, store: LockedStore) {
    const buckets = await tx.storeCreditBucket.findMany({
      where: { storeId: store.id },
    });
    const sum = buckets.reduce((s, b) => s + b.balanceToman, 0);
    const delta = store.creditBalanceToman - sum;
    if (delta === 0) return buckets;
    this.logger.warn(
      `credit invariant drift healed into LEGACY: store=${store.id} total=${store.creditBalanceToman} bucketsSum=${sum} delta=${delta}`,
    );
    await this.applyBucketDelta(tx, store.id, FALLBACK_SOURCE, delta);
    return tx.storeCreditBucket.findMany({ where: { storeId: store.id } });
  }

  private async applyBucketDelta(
    tx: Tx,
    storeId: string,
    source: CreditSource,
    delta: number,
  ): Promise<void> {
    await tx.storeCreditBucket.upsert({
      where: { storeId_source: { storeId, source } },
      create: { storeId, source, balanceToman: delta },
      update: { balanceToman: { increment: delta } },
    });
  }
}

export type { BucketCharge, PlanBucket };
