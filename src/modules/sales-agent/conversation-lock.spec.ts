import { ConversationEngineService } from './conversation-engine.service';
import { ConversationLockService } from './conversation-lock.service';

// PRD-nivo-sales-unified.md تسک 0.4 — قفل per-conversation + صف پیام‌های هم‌زمان
// Redis ساختگی درون‌حافظه‌ای که فقط دستورهای لازم را دارد
class FakeRedis {
  kv = new Map<string, string>();
  lists = new Map<string, string[]>();
  async set(k: string, v: string, _px: string, _ttl: number, nx: string) {
    if (nx === 'NX' && this.kv.has(k)) return null;
    this.kv.set(k, v);
    return 'OK';
  }
  async eval(_lua: string, _n: number, key: string, token: string) {
    if (this.kv.get(key) === token) {
      this.kv.delete(key);
      return 1;
    }
    return 0;
  }
  async llen(k: string) {
    return this.lists.get(k)?.length ?? 0;
  }
  multi() {
    const ops: (() => unknown)[] = [];
    const chain = {
      rpush: (k: string, v: string) => {
        ops.push(() => {
          const l = this.lists.get(k) ?? [];
          l.push(v);
          this.lists.set(k, l);
        });
        return chain;
      },
      ltrim: (k: string, start: number, end: number) => {
        ops.push(() => {
          const l = this.lists.get(k) ?? [];
          const e = end === -1 ? l.length : end + 1;
          const s = start < 0 ? Math.max(0, l.length + start) : start;
          this.lists.set(k, l.slice(s, e));
        });
        return chain;
      },
      expire: () => chain,
      lrange: (k: string) => {
        ops.push(() => [...(this.lists.get(k) ?? [])]);
        return chain;
      },
      del: (k: string) => {
        ops.push(() => {
          this.lists.delete(k);
        });
        return chain;
      },
      exec: async () => ops.map((o) => [null, o()]),
    };
    return chain;
  }
}

describe('ConversationLockService [0.4]', () => {
  it('قفل دوم نمی‌گیرد؛ release با توکن اشتباه قفل را نمی‌شکند', async () => {
    const lock = new ConversationLockService(new FakeRedis() as never);
    const t1 = await lock.acquire('c1');
    expect(t1).toBeTruthy();
    expect(await lock.acquire('c1')).toBeNull();
    await lock.release('c1', 'wrong');
    expect(await lock.acquire('c1')).toBeNull();
    await lock.release('c1', t1!);
    expect(await lock.acquire('c1')).toBeTruthy();
  });
  it('صف: ترتیب حفظ و drain اتمیک (دوباره خالی)', async () => {
    const lock = new ConversationLockService(new FakeRedis() as never);
    await lock.enqueue('c1', 'a');
    await lock.enqueue('c1', 'b');
    expect(await lock.drain('c1')).toEqual(['a', 'b']);
    expect(await lock.drain('c1')).toEqual([]);
  });
  it('سقف صف: قدیمی‌ترین‌ها دور ریخته می‌شوند', async () => {
    const lock = new ConversationLockService(new FakeRedis() as never);
    for (let i = 0; i < 30; i++) await lock.enqueue('c1', String(i));
    const items = await lock.drain('c1');
    expect(items).toHaveLength(20);
    expect(items[19]).toBe('29');
  });
});

describe('ConversationEngineService.handleMessage هم‌زمانی [0.4]', () => {
  const build = () => {
    const lock = new ConversationLockService(new FakeRedis() as never);
    const eng = Object.create(
      ConversationEngineService.prototype,
    ) as unknown as {
      handleMessage: (
        c: unknown,
        t: string,
      ) => Promise<Record<string, unknown>>;
    };
    let running = 0;
    let maxRunning = 0;
    const processed: string[] = [];
    const queuedResults: unknown[] = [];
    Object.assign(eng, {
      lock,
      logger: { error: jest.fn() },
      reloadConversation: async (c: unknown) => c,
      queuedResultListener: async (_id: string, r: unknown) => {
        queuedResults.push(r);
      },
      handleMessageInner: async (_c: unknown, text: string) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 20));
        processed.push(text);
        running--;
        return { reply: `ok:${text}`, uiBlocks: [], state: 'BROWSING' };
      },
    });
    return { eng, processed, queuedResults, getMax: () => maxRunning, lock };
  };
  const conv = { id: 'c1', currentState: 'BROWSING' };

  it('۵ پیام هم‌زمان: هیچ‌وقت دو turn هم‌زمان اجرا نمی‌شود و هیچ پیامی گم نمی‌شود', async () => {
    const { eng, processed, getMax, queuedResults } = build();
    const results = await Promise.all(
      ['m1', 'm2', 'm3', 'm4', 'm5'].map((t) => eng.handleMessage(conv, t)),
    );
    expect(getMax()).toBe(1);
    // اولین پیام برنده‌ی قفل است؛ چهار پیام دیگر queued=true می‌گیرند
    expect(results.filter((r) => r.queued)).toHaveLength(4);
    // همه‌ی پیام‌ها پردازش شدند (صف‌شده‌ها با هم در یک turn)
    const joined = processed.join('\n');
    for (const m of ['m1', 'm2', 'm3', 'm4', 'm5']) expect(joined).toContain(m);
    expect(processed).toHaveLength(2);
    expect(queuedResults).toHaveLength(1);
  });

  it('بعد از پایان، قفل آزاد است', async () => {
    const { eng, lock } = build();
    await eng.handleMessage(conv, 'x');
    const t = await lock.acquire('c1');
    expect(t).toBeTruthy();
  });

  it('خطا در turn قفل را آزاد می‌کند', async () => {
    const { eng, lock } = build();
    (eng as unknown as { handleMessageInner: unknown }).handleMessageInner =
      async () => {
        throw new Error('boom');
      };
    await expect(eng.handleMessage(conv, 'x')).rejects.toThrow('boom');
    expect(await lock.acquire('c1')).toBeTruthy();
  });
});
