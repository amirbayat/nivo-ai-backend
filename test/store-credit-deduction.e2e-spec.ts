/* eslint-disable @typescript-eslint/require-await */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { StoreCreditDeductionService } from '../src/modules/store-credit-engine/store-credit-deduction.service';
import {
  OVERDRAFT_FLOOR_TOMAN,
  TURN_COST_ESTIMATE_TOMAN,
} from '../src/common/constants/sales-ops.constants';
import { invalidateSalesAgentGlobalConfigCache } from '../src/modules/sales-agent/sales-agent-global-config.util';

// فاز ۱ (1.2) — تست واقعی روی Postgres: ناوردایی creditBalanceToman = Σ بخش‌ها زیر هم‌زمانی،
// کف overdraft با رزرو، ترمیم ناوردایی، شارژ چندمنبعی. روی DB موقت CI/لوکال اجرا می‌شود
// (DATABASE_URL)؛ بدون DATABASE_URL رد می‌شود.
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

class FakeRedis {
  private store = new Map<string, string>();
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.store.set(k, v);
    return 'OK';
  }
  async del(k: string) {
    this.store.delete(k);
    return 1;
  }
  async incrby(k: string, n: number) {
    const v = Number(this.store.get(k) ?? 0) + n;
    this.store.set(k, String(v));
    return v;
  }
  async decrby(k: string, n: number) {
    return this.incrby(k, -n);
  }
  async expire() {
    return 1;
  }
}

describeDb('StoreCreditDeductionService (Postgres واقعی)', () => {
  let prisma: PrismaClient;
  let svc: StoreCreditDeductionService;
  let sellerId: string;
  let seq = 0;

  const newStore = async (
    balance: number,
    opts: {
      trial?: number;
      buckets?: { source: 'ZIBAL' | 'SNAPPPAY' | 'LEGACY'; balance: number }[];
    } = {},
  ) => {
    const id = `st_${Date.now()}_${seq++}`;
    await prisma.store.create({
      data: {
        id,
        sellerId,
        slug: id,
        name: id,
        creditBalanceToman: balance,
        ...(opts.trial
          ? {
              trialCreditRemainingToman: opts.trial,
              trialEndsAt: new Date(Date.now() + 86_400_000),
            }
          : {}),
      },
    });
    const buckets =
      opts.buckets ??
      (balance !== 0 ? [{ source: 'LEGACY' as const, balance }] : []);
    for (const b of buckets) {
      await prisma.storeCreditBucket.create({
        data: { storeId: id, source: b.source, balanceToman: b.balance },
      });
    }
    return id;
  };

  const snapshot = async (storeId: string) => {
    const store = await prisma.store.findUniqueOrThrow({
      where: { id: storeId },
    });
    const agg = await prisma.storeCreditBucket.aggregate({
      where: { storeId },
      _sum: { balanceToman: true },
    });
    return {
      balance: store.creditBalanceToman,
      sum: agg._sum.balanceToman ?? 0,
      trial: store.trialCreditRemainingToman,
    };
  };

  const deduct = (
    storeId: string,
    raw: number,
    kind: 'BUYER' | 'SELLER' = 'BUYER',
  ) =>
    svc.deduct({
      storeId,
      rawCostToman: raw,
      kind,
      event: { model: 'test', kind: 'TEXT_REPLY' },
    });

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        max: 30,
      }),
    });
    await prisma.$connect();
    const user = await prisma.user.create({
      data: {
        email: `credit-e2e-${Date.now()}@test.local`,
        referralCode: `r${Date.now()}`,
      } as never,
    });
    sellerId = user.id;
    await prisma.salesAgentGlobalConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', buyerCostMarkup: 2, sellerCostMarkup: 1.5 },
      update: { buyerCostMarkup: 2, sellerCostMarkup: 1.5 },
    });
    invalidateSalesAgentGlobalConfigCache();
    svc = new StoreCreditDeductionService(
      prisma as never,
      new FakeRedis() as never,
    );
  });

  afterAll(async () => {
    await prisma.store.deleteMany({ where: { sellerId } });
    await prisma.user.delete({ where: { id: sellerId } });
    await prisma.$disconnect();
  });

  it('regression: تک‌بخش LEGACY دقیقاً ceil(raw × ضریب) کم می‌کند و رویداد با breakdown ثبت می‌شود', async () => {
    const id = await newStore(150_000);
    const out = await deduct(id, 1001);
    expect(out.chargedToman).toBe(2002);
    expect(await snapshot(id)).toMatchObject({
      balance: 147_998,
      sum: 147_998,
    });
    const ev = await prisma.creditUsageEvent.findFirstOrThrow({
      where: { storeId: id },
    });
    expect(ev.costToman).toBe(1001);
    expect(ev.chargedToman).toBe(2002);
    expect(ev.chargeBreakdown).toEqual([
      { source: 'LEGACY', chargedToman: 2002, markup: 2 },
    ]);
  });

  it('ضریب فروشنده ۱٫۵ برای kind=SELLER', async () => {
    const id = await newStore(10_000);
    const out = await deduct(id, 101, 'SELLER');
    expect(out.chargedToman).toBe(Math.ceil(101 * 1.5));
  });

  it('هم‌زمانی: ۳۰ کسر موازی → ناوردایی حفظ و مجموع دقیق', async () => {
    const id = await newStore(100_000);
    await Promise.all(Array.from({ length: 30 }, () => deduct(id, 100)));
    const snap = await snapshot(id);
    expect(snap.balance).toBe(100_000 - 30 * 200);
    expect(snap.sum).toBe(snap.balance);
    const events = await prisma.creditUsageEvent.count({
      where: { storeId: id },
    });
    expect(events).toBe(30);
  });

  it('هم‌زمانی چندمنبعی: کسر + شارژ موازی، ناوردایی حفظ می‌شود', async () => {
    const id = await newStore(0, {
      buckets: [
        { source: 'ZIBAL', balance: 50_000 },
        { source: 'SNAPPPAY', balance: 50_000 },
      ],
    });
    await prisma.store.update({
      where: { id },
      data: { creditBalanceToman: 100_000 },
    });
    await Promise.all([
      ...Array.from({ length: 20 }, () => deduct(id, 500)),
      ...Array.from({ length: 5 }, (_, i) =>
        prisma.$transaction((tx) =>
          svc.applyTopup(tx, {
            storeId: id,
            source: i % 2 ? 'ZIBAL' : 'SNAPPPAY',
            amountToman: 10_000,
          }),
        ),
      ),
    ]);
    const snap = await snapshot(id);
    expect(snap.sum).toBe(snap.balance);
    // کل: ۱۰۰٬۰۰۰ + ۵×۱۰٬۰۰۰ − مصرف؛ مصرف هر رویداد از چند بخش ممکن است ولی مجموعش ceil-ها
    const events = await prisma.creditUsageEvent.findMany({
      where: { storeId: id },
    });
    const charged = events.reduce((s, e) => s + e.chargedToman, 0);
    expect(snap.balance).toBe(150_000 - charged);
  });

  it('مصرف وسط مرز دو بخش: ارزان‌ترین اول و breakdown دقیق', async () => {
    await prisma.creditSourceMarkup.upsert({
      where: { source: 'SNAPPPAY' },
      create: { source: 'SNAPPPAY', buyerMarkup: 2.5, sellerMarkup: 1.875 },
      update: { buyerMarkup: 2.5 },
    });
    const id = await newStore(0, {
      buckets: [
        { source: 'SNAPPPAY', balance: 1000 },
        { source: 'ZIBAL', balance: 100 },
      ],
    });
    await prisma.store.update({
      where: { id },
      data: { creditBalanceToman: 1100 },
    });
    const out = await deduct(id, 100);
    // ZIBAL ۱۰۰ تومان = ۵۰ raw؛ SNAPPPAY ۵۰ raw × ۲٫۵ = ۱۲۵
    expect(out.breakdown).toEqual([
      { source: 'ZIBAL', chargedToman: 100, markup: 2 },
      { source: 'SNAPPPAY', chargedToman: 125, markup: 2.5 },
    ]);
    expect(await snapshot(id)).toMatchObject({ balance: 875, sum: 875 });
  });

  it('نشت آزمایشی اصلاح شده: آزمایشی تا موجودی‌اش، مابقی از بخش‌ها', async () => {
    const id = await newStore(5000, { trial: 100 });
    const out = await deduct(id, 100);
    expect(out.chargedToman).toBe(200);
    expect(out.breakdown.map((b) => b.source)).toEqual(['TRIAL', 'LEGACY']);
    expect(await snapshot(id)).toMatchObject({
      trial: 0,
      balance: 4900,
      sum: 4900,
    });
  });

  it('ترمیم ناوردایی: اگر کد قدیمی فقط creditBalanceToman را عوض کرده بود، اختلاف در LEGACY ترمیم می‌شود', async () => {
    const id = await newStore(10_000);
    await prisma.store.update({
      where: { id },
      data: { creditBalanceToman: { decrement: 3000 } }, // کد قدیمی بدون بخش‌ها
    });
    await deduct(id, 100);
    const snap = await snapshot(id);
    expect(snap.balance).toBe(10_000 - 3000 - 200);
    expect(snap.sum).toBe(snap.balance);
  });

  it('فروشگاه بدون هیچ بخش (backfill اجرا نشده) با موجودی قدیمی', async () => {
    const id = await newStore(10_000, { buckets: [] });
    await deduct(id, 100);
    const snap = await snapshot(id);
    expect(snap).toMatchObject({ balance: 9800, sum: 9800 });
  });

  it('کف overdraft: موجودی صفر و ۱۰ turn هم‌زمان → حداکثر تا کف (+ یک turn) خرج می‌شود', async () => {
    const id = await newStore(0);
    const actualRaw = 1000; // ۲۰۰۰ تومان بعد از ضریب (بیش از برآورد ۱۷۰۰)
    const results = await Promise.all(
      Array.from({ length: 10 }, async () => {
        if (!(await svc.reserveTurn(id))) return 'blocked' as const;
        try {
          await deduct(id, actualRaw);
          return 'ran' as const;
        } finally {
          await svc.releaseTurn(id);
        }
      }),
    );
    const ran = results.filter((r) => r === 'ran').length;
    const snap = await snapshot(id);
    expect(ran).toBeGreaterThanOrEqual(1);
    expect(ran).toBeLessThan(10);
    // زیر کف نمی‌رود مگر حداکثر به‌اندازه‌ی خطای برآورد یک turn
    expect(snap.balance).toBeGreaterThanOrEqual(
      -(OVERDRAFT_FLOOR_TOMAN + 2 * actualRaw),
    );
    expect(snap.sum).toBe(snap.balance);
  });

  it('canSpend: زیر کف false، بالای کف true؛ بعد از reserve/release موجودی رزرو آزاد می‌شود', async () => {
    const id = await newStore(-OVERDRAFT_FLOOR_TOMAN - 1);
    expect(await svc.canSpend(id)).toBe(false);
    const ok = await newStore(1);
    expect(await svc.canSpend(ok)).toBe(true);
    expect(await svc.reserveTurn(ok)).toBe(true);
    await svc.releaseTurn(ok);
    expect(TURN_COST_ESTIMATE_TOMAN).toBeGreaterThan(0);
  });

  it('خرید ثابت‌مبلغ: بخش اسنپ‌پی گران‌تر کسر می‌شود و ناوردایی حفظ است؛ ناکافی → false', async () => {
    await prisma.creditSourceMarkup.upsert({
      where: { source: 'SNAPPPAY' },
      create: { source: 'SNAPPPAY', buyerMarkup: 2.5, sellerMarkup: 1.875 },
      update: { buyerMarkup: 2.5 },
    });
    const id = await newStore(0, {
      buckets: [{ source: 'SNAPPPAY', balance: 500_000 }],
    });
    await prisma.store.update({
      where: { id },
      data: { creditBalanceToman: 500_000 },
    });
    const ok = await prisma.$transaction((tx) =>
      svc.debitFixedPrice(tx, { storeId: id, priceToman: 300_000 }),
    );
    expect(ok).toBe(375_000);
    expect(await snapshot(id)).toMatchObject({
      balance: 125_000,
      sum: 125_000,
    });
    const second = await prisma.$transaction((tx) =>
      svc.debitFixedPrice(tx, { storeId: id, priceToman: 300_000 }),
    );
    expect(second).toBeNull();
    expect(await snapshot(id)).toMatchObject({
      balance: 125_000,
      sum: 125_000,
    });
  });

  it('reevaluateBlockedConversations: بعد از شارژ، مکالمات BLOCKED دوباره PAID می‌شوند', async () => {
    const id = await newStore(0);
    const customer = await prisma.customer.create({
      data: { storeId: id, sessionToken: `t_${id}` } as never,
    });
    const conv = await prisma.salesConversation.create({
      data: {
        storeId: id,
        customerId: customer.id,
        billingMode: 'BLOCKED',
      } as never,
    });
    expect(await svc.reevaluateBlockedConversations(id)).toBe(0);
    await prisma.$transaction((tx) =>
      svc.applyTopup(tx, { storeId: id, source: 'ZIBAL', amountToman: 10_000 }),
    );
    expect(await svc.reevaluateBlockedConversations(id)).toBe(1);
    const after = await prisma.salesConversation.findUniqueOrThrow({
      where: { id: conv.id },
    });
    expect(after.billingMode).toBe('PAID');
  });

  it('findInvariantViolations ناهمخوانی را پیدا می‌کند', async () => {
    const id = await newStore(1000);
    await prisma.store.update({
      where: { id },
      data: { creditBalanceToman: 5 },
    });
    const violations = await svc.findInvariantViolations(1000);
    expect(violations.some((v) => v.storeId === id)).toBe(true);
  });
});
