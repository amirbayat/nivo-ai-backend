/* eslint-disable @typescript-eslint/require-await */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { StoreCreditDeductionService } from '../src/modules/store-credit-engine/store-credit-deduction.service';
import { AdminStoreCreditService } from '../src/modules/admin-store-credit/admin-store-credit.service';
import { AdminAuditService } from '../src/modules/admin-audit/admin-audit.service';

// R1.1 — تنظیم دستی اعتبار روی Postgres واقعی: ناوردایی، رویداد TOPUP، یک ردیف audit؛ کسر بیش از حد ← ۴۰۰
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb('AdminStoreCreditService.adjustCredit (Postgres واقعی) [R1.1]', () => {
  let prisma: PrismaClient;
  let svc: AdminStoreCreditService;
  let adminId: string;
  let sellerId: string;
  let storeId: string;

  const state = async () => {
    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    const sum = await prisma.storeCreditBucket.aggregate({
      where: { storeId },
      _sum: { balanceToman: true },
    });
    return { balance: store.creditBalanceToman, bucketsSum: sum._sum.balanceToman ?? 0 };
  };

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 5 }),
    });
    await prisma.$connect();
    const mk = (tag: string) =>
      prisma.user.create({
        data: { email: `r11-${tag}-${Date.now()}@test.local`, referralCode: `r${tag}${Date.now()}` } as never,
      });
    adminId = (await mk('a')).id;
    sellerId = (await mk('s')).id;
    storeId = `st_r11_${Date.now()}`;
    await prisma.store.create({
      data: { id: storeId, sellerId, slug: storeId, name: storeId, creditBalanceToman: 5000 } as never,
    });
    await prisma.storeCreditBucket.create({
      data: { storeId, source: 'ZIBAL', balanceToman: 5000 },
    });
    const redis = { get: async () => null, set: async () => 'OK', del: async () => 1 };
    const deduction = new StoreCreditDeductionService(prisma as never, redis as never);
    svc = new AdminStoreCreditService(prisma as never, deduction, new AdminAuditService(prisma as never));
  });

  afterAll(async () => {
    await prisma.adminAuditLog.deleteMany({ where: { adminId } });
    await prisma.store.deleteMany({ where: { sellerId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, sellerId] } } });
    await prisma.$disconnect();
  });

  it('+۱۰۰٬۰۰۰ ← ناوردایی، رویداد TOPUP (ADMIN_MANUAL) و یک ردیف audit', async () => {
    const r = await svc.adjustCredit({ adminId, storeId, amountToman: 100_000, reason: 'جبران خرابی' });
    expect(r).toEqual({ beforeToman: 5000, afterToman: 105_000 });
    const s = await state();
    expect(s.balance).toBe(105_000);
    expect(s.balance).toBe(s.bucketsSum);
    const events = await prisma.creditUsageEvent.findMany({ where: { storeId, kind: 'TOPUP' } });
    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('ADMIN_MANUAL');
    const audit = await prisma.adminAuditLog.findMany({ where: { targetId: storeId } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ adminId, action: 'CREDIT_ADJUST', reason: 'جبران خرابی' });
  });

  it('کسر از بخش‌ها ناوردایی را نگه می‌دارد', async () => {
    await svc.adjustCredit({ adminId, storeId, amountToman: -102_000, reason: 'اصلاح اشتباه' });
    const s = await state();
    expect(s.balance).toBe(3000);
    expect(s.balance).toBe(s.bucketsSum);
  });

  it('کسر بیش از کف overdraft ← ۴۰۰ و بدون تغییر و بدون audit تازه', async () => {
    const before = await state();
    const auditBefore = await prisma.adminAuditLog.count({ where: { targetId: storeId } });
    await expect(
      svc.adjustCredit({ adminId, storeId, amountToman: -50_000, reason: 'کسر زیاد' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await state()).toEqual(before);
    expect(await prisma.adminAuditLog.count({ where: { targetId: storeId } })).toBe(auditBefore);
  });
});
