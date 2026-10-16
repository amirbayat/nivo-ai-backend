import { runWithAceTurn, setCallSite, getAceContext } from './ace-context';
import { extractUsage, meterResponse } from './fetch-meter';
import { setLedgerSink, LedgerEntry } from './ledger-sink';
import { LedgerService } from './ledger.service';

describe('ACE-0 ledger', () => {
  afterEach(() => setLedgerSink(null));

  it('extractUsage: JSON و SSE', () => {
    const json = JSON.stringify({ model: 'm', usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.0001 } });
    expect(extractUsage(json).usage?.prompt_tokens).toBe(10);
    const sse = 'data: {"choices":[]}\n\ndata: {"model":"m","usage":{"prompt_tokens":7,"cost":0.5}}\n\ndata: [DONE]\n';
    expect(extractUsage(sse).usage?.prompt_tokens).toBe(7);
  });

  it('یک نوبت با ۳ call → ۳ ردیف با یک turnId و callSite', async () => {
    const rows: LedgerEntry[] = [];
    setLedgerSink((e) => rows.push(e));
    await runWithAceTurn(async () => {
      for (const site of ['main_loop', 'main_loop', 'faq_pick']) {
        setCallSite(site);
        const res = new Response(
          JSON.stringify({ model: 'x/y', usage: { prompt_tokens: 100, completion_tokens: 5, cost: 0.002, prompt_tokens_details: { cached_tokens: 60 } } }),
        );
        meterResponse('https://h/v1/chat/completions', { body: '{"model":"x/y"}' }, res, Date.now());
      }
      await new Promise((r) => setTimeout(r, 20));
    }, { storeId: 's1' });
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.turnId)).size).toBe(1);
    expect(rows[0]).toMatchObject({ callSite: 'main_loop', storeId: 's1', cachedInputTokens: 60, costUsdMicros: 2000 });
    expect(rows[2].callSite).toBe('faq_pick');
  });

  it('call بدون callSite → untagged؛ URL غیرمدل ثبت نمی‌شود', async () => {
    const rows: LedgerEntry[] = [];
    setLedgerSink((e) => rows.push(e));
    meterResponse('https://h/v1/chat/completions', undefined, new Response('{}'), Date.now());
    meterResponse('https://h/other', undefined, new Response('{}'), Date.now());
    await new Promise((r) => setTimeout(r, 20));
    expect(rows.map((r) => r.callSite)).toEqual(['untagged']);
    expect(getAceContext()).toBeUndefined();
  });

  it('خطای Prisma هرگز throw نمی‌کند', async () => {
    const svc = new LedgerService({ aiCallLedger: { createMany: jest.fn().mockRejectedValue(new Error('no table')) } } as never);
    svc.push({ callSite: 'x', servedBy: 'llm' });
    await expect(svc.flush()).resolves.toBeUndefined();
  });
});
