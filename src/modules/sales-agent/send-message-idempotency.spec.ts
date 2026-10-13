import { SalesAgentService } from './sales-agent.service';

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    set: jest.fn(async (k: string, v: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    }),
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    del: jest.fn(async (k: string) => {
      store.delete(k);
      return 1;
    }),
  };
}

function setup(handleMessage: jest.Mock) {
  const svc = Object.create(SalesAgentService.prototype) as SalesAgentService;
  const redis = fakeRedis();
  const conversation = {
    id: 'c1',
    currentState: 'BROWSING',
    isMutedForHuman: false,
  };
  Object.assign(svc, {
    redis,
    loadOwned: jest.fn().mockResolvedValue(conversation),
    engine: { handleMessage },
    attachVoicePending: jest.fn(async (_id: string, r: object) => ({
      ...r,
      awaitingReview: false,
    })),
  });
  return { svc, redis };
}

const dto = { message: 'سلام', clientMessageId: 'abcdef123456' };

describe('2.1 — Idempotency-Key پیام (clientMessageId)', () => {
  it('ارسال مجدد همان کلید: turn دوباره اجرا نمی‌شود و همان جواب برمی‌گردد', async () => {
    const handle = jest
      .fn()
      .mockResolvedValue({ reply: 'جواب', uiBlocks: [], state: 'BROWSING' });
    const { svc } = setup(handle);
    const first = await svc.sendMessage('c1', 'tok', dto as never);
    const second = await svc.sendMessage('c1', 'tok', dto as never);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second.reply).toBe('جواب');
  });

  it('کلید متفاوت: دو turn جدا', async () => {
    const handle = jest
      .fn()
      .mockResolvedValue({ reply: 'x', uiBlocks: [], state: 'BROWSING' });
    const { svc } = setup(handle);
    await svc.sendMessage('c1', 'tok', dto as never);
    await svc.sendMessage('c1', 'tok', {
      ...dto,
      clientMessageId: 'zzzzzzzz9999',
    } as never);
    expect(handle).toHaveBeenCalledTimes(2);
  });

  it('بدون کلید: رفتار قبلی (بدون ذخیره)', async () => {
    const handle = jest
      .fn()
      .mockResolvedValue({ reply: 'x', uiBlocks: [], state: 'BROWSING' });
    const { svc, redis } = setup(handle);
    await svc.sendMessage('c1', 'tok', { message: 'سلام' } as never);
    await svc.sendMessage('c1', 'tok', { message: 'سلام' } as never);
    expect(handle).toHaveBeenCalledTimes(2);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('درخواست هم‌زمان با همان کلید (هنوز در حال پردازش) → queued بدون اجرای دوم', async () => {
    let release!: (v: unknown) => void;
    const handle = jest.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { svc } = setup(handle);
    const p1 = svc.sendMessage('c1', 'tok', dto as never);
    await new Promise((r) => setImmediate(r));
    const second = await svc.sendMessage('c1', 'tok', dto as never);
    expect(second.queued).toBe(true);
    expect(handle).toHaveBeenCalledTimes(1);
    release({ reply: 'ok', uiBlocks: [], state: 'BROWSING' });
    await p1;
  });

  it('شکست turn کلید را آزاد می‌کند تا retry واقعی کار کند', async () => {
    const handle = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ reply: 'ok', uiBlocks: [], state: 'BROWSING' });
    const { svc } = setup(handle);
    await expect(svc.sendMessage('c1', 'tok', dto as never)).rejects.toThrow(
      'boom',
    );
    const retry = await svc.sendMessage('c1', 'tok', dto as never);
    expect(retry.reply).toBe('ok');
    expect(handle).toHaveBeenCalledTimes(2);
  });
});
