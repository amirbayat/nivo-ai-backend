import { DAILY_AGENT_MESSAGE_CAP, SellerSupportAgentService } from './seller-support-agent.service';

describe('SellerSupportAgentService daily cap [seller-support]', () => {
  const build = (count: number) => {
    const prisma = { sellerSupportMessage: { create: jest.fn() } };
    const redis = { incr: jest.fn().mockResolvedValue(count), expire: jest.fn() };
    const ticketService = { escalate: jest.fn().mockResolvedValue({ created: true }) };
    const svc = new SellerSupportAgentService(
      prisma as never, redis as never, { get: () => undefined } as never,
      {} as never, {} as never, {} as never, {} as never, ticketService as never,
    );
    return { svc, prisma, redis, ticketService };
  };

  it('بعد از سقف روزانه بدون فراخوانی AI مستقیم ارجاع می‌دهد', async () => {
    const { svc, ticketService } = build(DAILY_AGENT_MESSAGE_CAP + 1);
    const r = await svc.handle({ id: 's1' } as never, 'سلام');
    expect(r.capped).toBe(true);
    expect(ticketService.escalate).toHaveBeenCalledWith(expect.objectContaining({ lastMessage: 'سلام' }));
  });

  it('اولین پیام روز TTL شمارنده را ست می‌کند', async () => {
    const { svc, redis } = build(1);
    // loadMemory روی prisma ناقص می‌شکند؛ فقط ست‌شدن expire مهم است
    await svc.handle({ id: 's1' } as never, 'سلام').catch(() => undefined);
    expect(redis.expire).toHaveBeenCalled();
  });
});
