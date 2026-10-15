import { TelegramService } from './telegram.service';

// R0.3 — کارت بازپرداخت در تلگرام، حتی وقتی مکالمه‌ی سفارش ردشده mute/بایگانی است
describe('TelegramService.handleText refund card capture [R0.3]', () => {
  const build = (captured: unknown) => {
    const logs: unknown[] = [];
    const refunds = { tryCaptureForCustomers: jest.fn(async () => captured) };
    const prisma = {
      customer: { findMany: jest.fn(async () => [{ id: 'cust-1' }]) },
      salesConversation: { findUnique: jest.fn() },
      conversationEvent: {
        create: jest.fn(async (arg: unknown) => {
          logs.push(arg);
        }),
      },
    };
    const svc = Object.create(TelegramService.prototype) as Record<string, unknown>;
    const sent: string[] = [];
    Object.assign(svc, {
      prisma,
      refunds,
      logger: { warn: jest.fn(), log: jest.fn(), debug: jest.fn() },
      sendText: jest.fn(async (_chat: string, text: string) => {
        sent.push(text);
      }),
      resolveActiveConversation: jest.fn(async () => ({
        id: 'conv-1',
        isMutedForHuman: true,
      })),
      engine: { handleMessage: jest.fn() },
    });
    return { svc, refunds, sent, logs };
  };

  const send = (svc: Record<string, unknown>, text: string) =>
    (svc as unknown as { handleText: (m: unknown) => Promise<void> }).handleText({
      chat: { id: 99 },
      text,
    });

  it('کارت معتبر ← ثبت می‌شود، پاسخ تایید می‌رود، چیزی لاگ نمی‌شود', async () => {
    const { svc, refunds, sent, logs } = build({
      reply: 'شماره کارتت ثبت شد ✅',
      masked: '4111-11**-****-1111',
      refundId: 'r1',
      orderId: 'o1',
      amountToman: 1000,
    });
    await send(svc, '4111111111111111');
    expect(refunds.tryCaptureForCustomers).toHaveBeenCalledWith(['cust-1'], '4111111111111111');
    expect(sent).toEqual(['شماره کارتت ثبت شد ✅']);
    expect(JSON.stringify(logs)).not.toMatch(/\d{16}/);
  });

  it('کارت بدون refund منتظر ← در مکالمه‌ی mute فقط مقدار ماسک‌شده لاگ می‌شود', async () => {
    const { svc, logs } = build(null);
    await send(svc, '1234 5678 1234 5678');
    expect(JSON.stringify(logs)).not.toMatch(/\d{16}/);
    expect(JSON.stringify(logs)).toContain('1234-****-****-5678');
  });
});
