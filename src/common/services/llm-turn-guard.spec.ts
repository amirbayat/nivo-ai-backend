import {
  LlmDeadlineError,
  LlmSaturatedError,
  Semaphore,
  guardFetch,
  runLlmTurn,
} from './llm-turn-guard';

describe('guardFetch', () => {
  it('بیرون از context یک turn: دقیقاً pass-through (signal دست‌نخورده)', async () => {
    const inner = jest.fn().mockResolvedValue('ok');
    const init = { method: 'POST' };
    await guardFetch(inner)('http://x', init);
    expect(inner).toHaveBeenCalledWith('http://x', init);
  });

  it('داخل turn: signal با timeout اضافه می‌شود', async () => {
    const inner = jest.fn().mockResolvedValue('ok');
    await runLlmTurn(() => guardFetch(inner)('http://x', {}));
    const init = inner.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('بعد از deadline فوراً LlmDeadlineError می‌دهد و call انجام نمی‌شود', async () => {
    const inner = jest.fn();
    await expect(
      runLlmTurn(async () => {
        await new Promise((r) => setTimeout(r, 30));
        return guardFetch(inner)('http://x', {});
      }, 10),
    ).rejects.toBeInstanceOf(LlmDeadlineError);
    expect(inner).not.toHaveBeenCalled();
  });

  it('call کند با timeout قطع می‌شود', async () => {
    const inner = jest.fn(
      (_: unknown, init?: RequestInit) =>
        new Promise((_res, rej) => {
          init?.signal?.addEventListener('abort', () =>
            rej(init.signal!.reason),
          );
        }),
    );
    await expect(
      runLlmTurn(() => guardFetch(inner as never)('http://x', {}), 50),
    ).rejects.toBeDefined();
  });

  it('turn تودرتو deadline بیرونی را حفظ می‌کند', async () => {
    const inner = jest.fn().mockResolvedValue('ok');
    await expect(
      runLlmTurn(
        () =>
          runLlmTurn(async () => {
            await new Promise((r) => setTimeout(r, 30));
            return guardFetch(inner)('http://x', {});
          }, 60_000),
        10,
      ),
    ).rejects.toBeInstanceOf(LlmDeadlineError);
  });
});

describe('Semaphore', () => {
  it('حداکثر max هم‌زمان؛ بقیه به ترتیب نوبت می‌گیرند', async () => {
    const s = new Semaphore(2, 10);
    const r1 = await s.acquire(1000);
    const r2 = await s.acquire(1000);
    const order: number[] = [];
    const p3 = s.acquire(1000).then((r) => {
      order.push(3);
      return r;
    });
    const p4 = s.acquire(1000).then((r) => {
      order.push(4);
      return r;
    });
    await Promise.resolve();
    expect(s.stats).toEqual({ active: 2, waiting: 2 });
    r1();
    const r3 = await p3;
    expect(order).toEqual([3]);
    r2();
    const r4 = await p4;
    expect(order).toEqual([3, 4]);
    r3();
    r4();
    expect(s.stats).toEqual({ active: 0, waiting: 0 });
  });

  it('صف پر → LlmSaturatedError؛ isSaturated درست است', async () => {
    const s = new Semaphore(1, 1);
    const r1 = await s.acquire(1000);
    const waiting = s.acquire(1000);
    expect(s.isSaturated).toBe(true);
    await expect(s.acquire(1000)).rejects.toBeInstanceOf(LlmSaturatedError);
    r1();
    (await waiting)();
    expect(s.isSaturated).toBe(false);
  });

  it('انتظار بیش از مهلت → LlmDeadlineError و از صف حذف می‌شود', async () => {
    const s = new Semaphore(1, 5);
    const r1 = await s.acquire(1000);
    await expect(s.acquire(20)).rejects.toBeInstanceOf(LlmDeadlineError);
    expect(s.stats.waiting).toBe(0);
    r1();
    expect(s.stats.active).toBe(0);
  });
});
