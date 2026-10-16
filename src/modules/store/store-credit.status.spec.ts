import { StoreCreditService } from './store-credit.service';

function build(rows: { conversations: number; charged: number }[], balance: number, trial = 0) {
  const prisma = {
    customer: { count: jest.fn().mockResolvedValue(0) },
    salesAgentGlobalConfig: {
      findFirst: jest.fn().mockResolvedValue({ freeDailyQuota: 5 }),
      findUnique: jest.fn().mockResolvedValue({ freeDailyQuota: 5 }),
      upsert: jest.fn().mockResolvedValue({ freeDailyQuota: 5 }),
    },
    $queryRaw: jest.fn().mockResolvedValue(rows),
  };
  const svc = new StoreCreditService(
    prisma as never,
    {
      getOwned: jest.fn(async () => ({
        id: 's',
        creditBalanceToman: balance,
        trialEndsAt: trial > 0 ? new Date(Date.now() + 86_400_000) : null,
        trialCreditRemainingToman: trial,
      })),
    } as never,
    {} as never,
    {} as never,
  );
  return svc;
}

describe('StoreCreditService.getStatus conversationsLeftEstimate [R3.4]', () => {
  it('با ≥۲۰ مکالمه تخمین می‌دهد', async () => {
    const svc = build([{ conversations: 40, charged: 400_000 }], 100_000);
    const res = await svc.getStatus('u', 's');
    expect(res.conversationsLeftEstimate).toBe(10);
  });
  it('با کمتر از ۲۰ مکالمه null است', async () => {
    const svc = build([{ conversations: 5, charged: 50_000 }], 100_000);
    const res = await svc.getStatus('u', 's');
    expect(res.conversationsLeftEstimate).toBeNull();
  });
  it('موجودی منفی ← balance منفی برمی‌گردد (فرانت «بدهکار» نشان می‌دهد) و تخمین ۰', async () => {
    const svc = build([{ conversations: 40, charged: 400_000 }], -30_000);
    const res = await svc.getStatus('u', 's');
    expect(res.balanceToman).toBe(-30_000);
    expect(res.conversationsLeftEstimate).toBe(0);
  });
  it('QA-10: اعتبار هدیه‌ی فعال در برآورد گفتگو شمرده می‌شود', async () => {
    const svc = build([{ conversations: 40, charged: 400_000 }], 0, 100_000);
    const res = await svc.getStatus('u', 's');
    expect(res.trialCreditRemainingToman).toBe(100_000);
    expect(res.conversationsLeftEstimate).toBe(10);
  });
});
