/* eslint-disable @typescript-eslint/require-await */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { StoreCreditDeductionService } from '../src/modules/store-credit-engine/store-credit-deduction.service';

// فاز ۱ (1.4) — callback پرداخت idempotent واقعی روی Postgres: چند callback هم‌زمان برای یک
// پرداخت فقط یک‌بار شارژ می‌کنند و هیچ‌کدام 500 نمی‌دهند؛ callback ناموفقِ دیرهنگام پرداخت
// COMPLETED را خراب نمی‌کند؛ شارژ در بخش منبع (درگاه) ثبت و chargedToman پر می‌شود.
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
}

describeDb('PaymentsService.verify — idempotency (Postgres واقعی)', () => {
  let prisma: PrismaClient;
  let svc: PaymentsService;
  let userId: string;
  let storeId: string;
  let seq = 0;

  const verify = (
    providerRef: string,
    success: boolean,
    gatewayOk = true,
  ): Promise<{ redirect: string }> =>
    (
      svc as unknown as {
        verify: (
          g: unknown,
          ref: string,
          ok: boolean,
        ) => Promise<{ redirect: string }>;
      }
    ).verify(
      {
        verifyPayment: jest
          .fn()
          .mockResolvedValue({ success: gatewayOk, refId: 'REF1' }),
      },
      providerRef,
      success,
    );

  const newPayment = async (amount: number) => {
    const providerRef = `ref_${Date.now()}_${seq++}`;
    const p = await prisma.payment.create({
      data: {
        userId,
        storeId,
        kind: 'STORE_CREDIT_TOPUP',
        amount,
        provider: 'ZIBAL',
        providerRef,
      },
    });
    return { id: p.id, providerRef };
  };

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        max: 20,
      }),
    });
    await prisma.$connect();
    const user = await prisma.user.create({
      data: {
        phone: `0912${Date.now().toString().slice(-7)}`,
        referralCode: `p${Date.now()}`,
      } as never,
    });
    userId = user.id;
    const store = await prisma.store.create({
      data: {
        sellerId: userId,
        slug: `pay_${Date.now()}`,
        name: 'pay',
      },
    });
    storeId = store.id;
    svc = new PaymentsService(
      prisma as never,
      {} as never,
      { invalidatePlanCache: jest.fn() } as never,
      {} as never,
      {} as never,
      { get: () => 'https://app.test' } as never,
      { notify: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      new StoreCreditDeductionService(
        prisma as never,
        new FakeRedis() as never,
      ),
    );
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { userId } });
    await prisma.payment.deleteMany({ where: { userId } });
    await prisma.store.deleteMany({ where: { sellerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('۵ callback هم‌زمان: فقط یک شارژ، یک فاکتور، همه صفحه‌ی موفقیت', async () => {
    const { id, providerRef } = await newPayment(200_000);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => verify(providerRef, true)),
    );
    for (const r of results) expect(r.redirect).toContain('status=success');

    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('COMPLETED');
    expect(await prisma.invoice.count({ where: { paymentId: id } })).toBe(1);
    const store = await prisma.store.findUniqueOrThrow({
      where: { id: storeId },
    });
    const buckets = await prisma.storeCreditBucket.findMany({
      where: { storeId },
    });
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({
      source: 'ZIBAL',
      balanceToman: 200_000,
    });
    expect(store.creditBalanceToman).toBe(200_000);
    const topups = await prisma.creditUsageEvent.findMany({
      where: { storeId, kind: 'TOPUP' },
    });
    expect(topups).toHaveLength(1);
    expect(topups[0]).toMatchObject({
      source: 'ZIBAL',
      costToman: 200_000,
      chargedToman: 200_000,
    });
  });

  it('callback «ناموفق» دیرهنگام، پرداخت COMPLETED را FAILED نمی‌کند', async () => {
    const { id, providerRef } = await newPayment(50_000);
    await verify(providerRef, true);
    const late = await verify(providerRef, false);
    expect(late.redirect).toContain('status=failed'); // پیام کاربر همان callback است
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('COMPLETED');
  });

  it('verify درگاه برای callback دوم «ناموفق» برگرداند ولی پرداخت قبلاً COMPLETED شده: صفحه‌ی موفقیت', async () => {
    const { id, providerRef } = await newPayment(70_000);
    await verify(providerRef, true);
    // callback دوم از مسیر status!==PENDING رد می‌شود (alreadyCompleted)
    const again = await verify(providerRef, true, false);
    expect(again.redirect).toContain('status=success');
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('COMPLETED');
  });

  it('شارژ دوم از درگاه دیگر: بخش جدا و ناوردایی حفظ', async () => {
    const before = await prisma.store.findUniqueOrThrow({
      where: { id: storeId },
    });
    const { providerRef } = await newPayment(10_000);
    await prisma.payment.update({
      where: { providerRef },
      data: { provider: 'ZARINPAL' },
    });
    await verify(providerRef, true);
    const store = await prisma.store.findUniqueOrThrow({
      where: { id: storeId },
    });
    const agg = await prisma.storeCreditBucket.aggregate({
      where: { storeId },
      _sum: { balanceToman: true },
    });
    expect(store.creditBalanceToman).toBe(before.creditBalanceToman + 10_000);
    expect(agg._sum.balanceToman).toBe(store.creditBalanceToman);
    expect(
      await prisma.storeCreditBucket.findUnique({
        where: { storeId_source: { storeId, source: 'ZARINPAL' } },
      }),
    ).toMatchObject({ balanceToman: 10_000 });
  });
});
