import {
  aceActive, emergencyRevertToStable, getAceSettings, ledgerEnabledSync, resetAceConfigCache,
  resolveEngineMode, undoEmergencyRevert, updateAceSettings,
} from './ace-config';
import { runWithAceTurn } from './ace-context';
import { setAceRuntime } from './ace-runtime';

function fakeRedis() {
  const m = new Map<string, string>();
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => { m.set(k, v); return 'OK'; },
    incr: async (k: string) => { const n = Number(m.get(k) ?? 0) + 1; m.set(k, String(n)); return n; },
    del: async (k: string) => (m.delete(k) ? 1 : 0),
    expire: async () => 1,
  };
}

let row: { layers: unknown; params: unknown } | null;
let redis: ReturnType<typeof fakeRedis>;

beforeEach(() => {
  row = null;
  redis = fakeRedis();
  resetAceConfigCache();
  setAceRuntime({
    redis: redis as never,
    loadConfig: async () => row,
    saveConfig: async (d) => { row = d; },
  });
});

describe('engine mode', () => {
  it('جدول/تنظیمات نبود → stable', async () => {
    expect(await resolveEngineMode('c1', 's1')).toBe('stable');
  });

  it('خطای خواندن config → stable و بدون throw', async () => {
    setAceRuntime({ loadConfig: async () => { throw new Error('no table'); } });
    resetAceConfigCache();
    expect(await resolveEngineMode('c1', 's1')).toBe('stable');
  });

  it('storeOverrides در هر دو جهت فقط همان فروشگاه را عوض می‌کند', async () => {
    await updateAceSettings({ storeOverride: { storeId: 'mine', mode: 'lean' } }, 'a1');
    expect(await resolveEngineMode('c1', 'mine')).toBe('lean');
    expect(await resolveEngineMode('c2', 'other')).toBe('stable');

    await updateAceSettings({ engineMode: 'lean', storeOverride: { storeId: 'sensitive', mode: 'stable' } }, 'a1');
    expect(await resolveEngineMode('c3', 'sensitive')).toBe('stable');
    expect(await resolveEngineMode('c4', 'other')).toBe('lean');
  });

  it('sticky: تغییر کلید وسط گفتگو موتور را عوض نمی‌کند', async () => {
    expect(await resolveEngineMode('c1', 's1')).toBe('stable');
    await updateAceSettings({ engineMode: 'lean' }, 'a1');
    expect(await resolveEngineMode('c1', 's1')).toBe('stable');
    expect(await resolveEngineMode('c-new', 's1')).toBe('lean');
  });

  it('برگرداندن فوری: sticky نادیده گرفته می‌شود و همه‌ی گفتگوها stable می‌شوند', async () => {
    await updateAceSettings({ engineMode: 'lean', storeOverride: { storeId: 's1', mode: 'lean' } }, 'a1');
    expect(await resolveEngineMode('c1', 's1')).toBe('lean');
    await new Promise((r) => setTimeout(r, 2));
    await emergencyRevertToStable('a2');
    expect(await resolveEngineMode('c1', 's1')).toBe('stable');
    const s = await getAceSettings();
    expect(s.engineMode).toBe('stable');
    expect(s.storeOverrides).toEqual({});
  });

  it('لغو برگرداندن فوری نسخه‌ی قبلی را برمی‌گرداند', async () => {
    await updateAceSettings({ engineMode: 'lean', storeOverride: { storeId: 's1', mode: 'stable' } }, 'a1');
    await emergencyRevertToStable('a2');
    expect(await undoEmergencyRevert('a2')).toBe(true);
    const s = await getAceSettings();
    expect(s.engineMode).toBe('lean');
    expect(s.storeOverrides).toEqual({ s1: 'stable' });
  });

  it('دو instance: بالا رفتن ace:config:ver کش instance دیگر را باطل می‌کند', async () => {
    expect(await resolveEngineMode('c0', 's1')).toBe('stable');
    // instance دیگر مستقیم در DB می‌نویسد و ver را بالا می‌برد
    row = { layers: { engineMode: 'lean' }, params: {} };
    await redis.incr('ace:config:ver');
    expect(await resolveEngineMode('c-fresh', 's1')).toBe('lean');
  });

  it('هر تغییر یک ردیف audit می‌سازد و سقف ۵۰ دارد', async () => {
    await updateAceSettings({ engineMode: 'lean' }, 'a1');
    let s = await getAceSettings();
    expect(s.audit[0]).toMatchObject({ adminId: 'a1', field: 'engineMode', from: 'stable', to: 'lean' });
    for (let i = 0; i < 60; i++) {
      await updateAceSettings({ layers: { memo: i % 2 ? 'on' : 'shadow' } }, 'a1');
    }
    s = await getAceSettings();
    expect(s.audit).toHaveLength(50);
  });

  it('تغییر بدون اثر ردیف audit نمی‌سازد', async () => {
    await updateAceSettings({ engineMode: 'stable' }, 'a1');
    expect((await getAceSettings()).audit).toHaveLength(0);
  });

  it('redis قطع → از روی تنظیمات، بدون خطا', async () => {
    setAceRuntime({ redis: { get: async () => { throw new Error('down'); }, set: async () => { throw new Error('down'); }, incr: async () => { throw new Error('down'); }, del: async () => 0, expire: async () => 0 } as never });
    await updateAceSettings({ engineMode: 'lean' }, 'a1');
    expect(await resolveEngineMode('c1', 's1')).toBe('lean');
  });
});

describe('aceActive', () => {
  it('در stable هیچ لایه‌ای فعال نیست حتی اگر on باشد', async () => {
    await updateAceSettings({ layers: { memo: 'on' } }, 'a1');
    await runWithAceTurn(async () => expect(await aceActive('memo')).toBe(false), { engine: 'stable' });
    await runWithAceTurn(async () => expect(await aceActive('memo')).toBe(false), {});
  });

  it('در lean فقط لایه‌ی غیر off فعال است', async () => {
    await updateAceSettings({ layers: { memo: 'on' } }, 'a1');
    await runWithAceTurn(async () => {
      expect(await aceActive('memo')).toBe(true);
      expect(await aceActive('semanticCache')).toBe(false);
    }, { engine: 'lean' });
  });
});

describe('layers.ledger', () => {
  it('پیش‌فرض روشن و با off خاموش', async () => {
    expect(ledgerEnabledSync()).toBe(true);
    await updateAceSettings({ layers: { ledger: 'off' } }, 'a1');
    await getAceSettings();
    expect(ledgerEnabledSync()).toBe(false);
  });
});
