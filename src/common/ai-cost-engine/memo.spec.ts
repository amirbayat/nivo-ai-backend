import { resetAceConfigCache } from './ace-config';
import { setAceRuntime } from './ace-runtime';
import { cachedEmbedding } from './embedding-cache';
import { memoCall } from './memo-cache';
import { bumpVersions } from './version-keys';

class FakeRedis {
  m = new Map<string, string>();
  async get(k: string) { return this.m.get(k) ?? null; }
  async set(k: string, v: string, ...a: unknown[]) {
    if (a.includes('NX') && this.m.has(k)) return null;
    this.m.set(k, v);
    return 'OK';
  }
  async incr(k: string) { const n = Number(this.m.get(k) ?? 0) + 1; this.m.set(k, String(n)); return n; }
  async del(k: string) { this.m.delete(k); return 1; }
  async expire() { return 1; }
}

const setup = (layers: Record<string, string>, redis: unknown = new FakeRedis()) => {
  resetAceConfigCache();
  setAceRuntime({ redis: redis as never, loadConfig: async () => ({ layers, params: {} }) });
  return redis as FakeRedis;
};
afterEach(() => { resetAceConfigCache(); setAceRuntime({ redis: null, loadConfig: null }); });

describe('memoCall (ACE-3)', () => {
  const base = { callSite: 'faq_pick', keyInput: { q: 'a' }, sources: { storeId: 's1', kb: true } };

  it('دو call یکسان → یک compute', async () => {
    setup({ memo: 'on' });
    const compute = jest.fn(async () => ({ ok: 1 }));
    expect(await memoCall({ ...base, compute })).toEqual({ ok: 1 });
    expect(await memoCall({ ...base, compute })).toEqual({ ok: 1 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('bumpVersions → call بعدی miss', async () => {
    setup({ memo: 'on' });
    const compute = jest.fn(async () => 1);
    await memoCall({ ...base, compute });
    await bumpVersions({ storeId: 's1', kb: true });
    await memoCall({ ...base, compute });
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('۱۰ call هم‌زمان یکسان → یک compute (single-flight)', async () => {
    setup({ memo: 'on' });
    const compute = jest.fn(async () => { await new Promise((r) => setTimeout(r, 300)); return 7; });
    const res = await Promise.all(Array.from({ length: 10 }, () => memoCall({ ...base, compute })));
    expect(res.every((r) => r === 7)).toBe(true);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('لایه off یا Redis خراب → مستقیم compute، بدون خطا', async () => {
    setup({ memo: 'off' });
    const compute = jest.fn(async () => 1);
    await memoCall({ ...base, compute });
    await memoCall({ ...base, compute });
    expect(compute).toHaveBeenCalledTimes(2);

    const broken = { get: async () => { throw new Error('down'); }, set: async () => { throw new Error('down'); }, incr: async () => { throw new Error('down'); }, del: async () => 1, expire: async () => 1 };
    setup({ memo: 'on' }, broken);
    const c2 = jest.fn(async () => 5);
    expect(await memoCall({ ...base, compute: c2 })).toBe(5);
  });

  it('فروشگاه‌ها کش مشترک ندارند (I-2)', async () => {
    setup({ memo: 'on' });
    const compute = jest.fn(async () => 1);
    await memoCall({ ...base, compute });
    await memoCall({ ...base, keyInput: { q: 'a' }, sources: { storeId: 's2', kb: true }, compute });
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

describe('cachedEmbedding (ACE-4)', () => {
  it('متن نرمال‌شده‌ی یکسان → یک compute', async () => {
    setup({ embedCache: 'on' });
    const compute = jest.fn(async () => [0.5, -1.25, 3]);
    const a = await cachedEmbedding('m', 'قيمت  چنده', compute);
    const b = await cachedEmbedding('m', 'قیمت چنده', compute);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
    expect(b).toEqual([0.5, -1.25, 3]);
  });
  it('خاموش → همیشه compute', async () => {
    setup({});
    const compute = jest.fn(async () => [1]);
    await cachedEmbedding('m', 'x', compute);
    await cachedEmbedding('m', 'x', compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
