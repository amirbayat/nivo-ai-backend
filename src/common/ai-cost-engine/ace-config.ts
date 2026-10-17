import { aceRuntime } from './ace-runtime';
import { getAceContext } from './ace-context';

export type LayerName =
  | 'ledger' | 'promptCache' | 'memo' | 'embedCache' | 'subcallDiet' | 'loopDiet' | 'dedupe'
  | 'offTopicBudget' | 'fastAnswers' | 'semanticCache' | 'ttsCache' | 'productBrief';
export type LayerMode = 'off' | 'shadow' | 'on';
export type EngineMode = 'stable' | 'lean';

// پیش‌فرض امن: همه off (بخش ۹ سند). لایه‌ای که متن جواب را عوض می‌کند هرگز پیش‌فرض on نیست.
// تنها استثنا ledger است: فقط ثبت می‌کند و در هر دو موتور روشن است.
export const DEFAULT_LAYERS: Record<LayerName, LayerMode> = {
  ledger: 'on',
  promptCache: 'off', memo: 'off', embedCache: 'off', subcallDiet: 'off', loopDiet: 'off',
  dedupe: 'off', offTopicBudget: 'off', fastAnswers: 'off', semanticCache: 'off', ttsCache: 'off',
  productBrief: 'off',
};
export const DEFAULT_PARAMS = {
  memoTtlSec: 3600,
  embeddingTtlSec: 7 * 24 * 3600,
  dedupeWindowSec: 30,
  offTopicMax: 3,
};
export type AceParams = typeof DEFAULT_PARAMS;

export interface AceAuditEntry {
  at: string;
  adminId: string | null;
  field: string;
  from: unknown;
  to: unknown;
}

export interface AceEngineSettings {
  engineMode: EngineMode;
  storeOverrides: Record<string, EngineMode>;
  audit: AceAuditEntry[];
  // زمان آخرین «برگرداندن فوری»؛ sticky قدیمی‌تر از آن نادیده گرفته می‌شود
  revertedAt: number;
}

const AUDIT_MAX = 50;
const CACHE_MS = 60_000;
const STICKY_TTL_SEC = 7 * 24 * 3600;
const VER_KEY = 'ace:config:ver';

interface Loaded extends AceEngineSettings {
  at: number;
  layers: Record<LayerName, LayerMode>;
  params: AceParams;
  ver: string | null;
}

let cached: Loaded | null = null;
let loading: Promise<Loaded> | null = null;
let warned = false;

export function resetAceConfigCache(): void {
  cached = null;
}

const isEngine = (v: unknown): v is EngineMode => v === 'stable' || v === 'lean';

async function loadFresh(): Promise<Loaded> {
  const layers = { ...DEFAULT_LAYERS };
  let params = { ...DEFAULT_PARAMS };
  let engineMode: EngineMode = 'stable';
  let storeOverrides: Record<string, EngineMode> = {};
  let audit: AceAuditEntry[] = [];
  let revertedAt = 0;
  try {
    const row = await aceRuntime().loadConfig?.();
    if (row) {
      const l = (row.layers ?? {}) as Record<string, unknown>;
      for (const k of Object.keys(DEFAULT_LAYERS) as LayerName[]) {
        if (l[k] === 'off' || l[k] === 'shadow' || l[k] === 'on') layers[k] = l[k] as LayerMode;
      }
      if (isEngine(l.engineMode)) engineMode = l.engineMode;
      if (l.storeOverrides && typeof l.storeOverrides === 'object') {
        for (const [sid, m] of Object.entries(l.storeOverrides as Record<string, unknown>)) {
          if (isEngine(m)) storeOverrides[sid] = m;
        }
      }
      if (Array.isArray(l.audit)) audit = (l.audit as AceAuditEntry[]).slice(0, AUDIT_MAX);
      if (typeof l.revertedAt === 'number') revertedAt = l.revertedAt;
      params = { ...params, ...((row.params ?? {}) as Partial<AceParams>) };
    }
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn(`[ACE] config table unavailable, defaults used: ${(err as Error).message}`);
    }
  }
  let ver: string | null = null;
  try {
    ver = (await aceRuntime().redis?.get(VER_KEY)) ?? null;
  } catch {
    /* fail-open */
  }
  return { at: Date.now(), layers, params, engineMode, storeOverrides, audit, revertedAt, ver };
}

async function load(): Promise<Loaded> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached;
  loading ??= loadFresh()
    .then((r) => (cached = r))
    .finally(() => {
      loading = null;
    });
  return loading;
}

// چند instance: «برگرداندن فوری» یک کلید Redis را بالا می‌برد؛ هر نوبت یک GET ارزان، تغییر → کش را دور بریز
async function freshForTurn(): Promise<Loaded> {
  const cur = await load();
  try {
    const v = (await aceRuntime().redis?.get(VER_KEY)) ?? null;
    if (v !== cur.ver) {
      cached = null;
      return await load();
    }
  } catch {
    /* fail-open */
  }
  return cur;
}

export async function layerMode(name: LayerName): Promise<LayerMode> {
  return (await load()).layers[name];
}

// برای meter داخل guardFetch (sync): کش فعلی، و refresh پس‌زمینه وقتی کهنه است. نبودن کش = روشن.
export function ledgerEnabledSync(): boolean {
  if (!cached || Date.now() - cached.at >= CACHE_MS) void load().catch(() => undefined);
  return (cached?.layers.ledger ?? DEFAULT_LAYERS.ledger) !== 'off';
}

export async function aceParams(): Promise<AceParams> {
  return (await load()).params;
}

export async function getAceSettings(): Promise<AceEngineSettings & { layers: Record<LayerName, LayerMode>; params: AceParams }> {
  const c = await load();
  return { engineMode: c.engineMode, storeOverrides: c.storeOverrides, audit: c.audit, revertedAt: c.revertedAt, layers: c.layers, params: c.params };
}

function decide(c: Loaded, storeId: string): EngineMode {
  return c.storeOverrides[storeId] ?? c.engineMode;
}

// بخش ۱۲.۲: sticky از Redis → وگرنه storeOverrides → وگرنه engineMode. هر خطا → stable.
export async function resolveEngineMode(conversationId: string, storeId: string): Promise<EngineMode> {
  try {
    const c = await freshForTurn();
    const redis = aceRuntime().redis;
    const key = `ace:mode:${conversationId}`;
    if (redis) {
      try {
        const raw = await redis.get(key);
        if (raw) {
          const [m, ts] = raw.split('|');
          if (isEngine(m) && Number(ts) >= c.revertedAt) return m;
        }
      } catch {
        /* sticky نخواند → از تنظیمات */
      }
    }
    const mode = decide(c, storeId);
    if (redis) {
      try {
        await redis.set(key, `${mode}|${Date.now()}`, 'EX', STICKY_TTL_SEC);
      } catch {
        /* fail-open */
      }
    }
    return mode;
  } catch {
    return 'stable';
  }
}

// لایه‌های بدون اثر روی متن جواب (memo، embedCache) هم در نوبت‌های بات فقط در lean کار می‌کنند (I-9)؛
// بیرون از نوبت بات (سمت فروشنده) context موتور ندارد و فقط کلید لایه تصمیم می‌گیرد.
export function engineAllowsLayers(): boolean {
  return getAceContext()?.engine !== 'stable';
}

// هر لایه فقط همین را می‌پرسد (بخش ۱۲.۲)
export async function aceActive(layer: LayerName): Promise<boolean> {
  if (getAceContext()?.engine !== 'lean') return false;
  return (await layerMode(layer)) !== 'off';
}

// لایه‌ای که فقط در حالت on اثر می‌گذارد (shadow برای آن هنوز مصرف نیست: نیاز به judge ACE-12)
export async function aceOn(layer: LayerName): Promise<boolean> {
  if (getAceContext()?.engine !== 'lean') return false;
  return (await layerMode(layer)) === 'on';
}

// لایه‌ای که در حالت shadow فقط کاندید می‌سازد و ثبت می‌کند (جواب واقعی از LLM)
export async function aceShadow(layer: LayerName): Promise<boolean> {
  if (getAceContext()?.engine !== 'lean') return false;
  return (await layerMode(layer)) === 'shadow';
}

// ───────── نوشتن (فقط ادمین) ─────────
async function persist(next: { layers: Record<string, unknown>; params: AceParams }): Promise<void> {
  const save = aceRuntime().saveConfig;
  if (!save) throw new Error('config store unavailable');
  await save({ layers: next.layers, params: next.params });
  cached = null;
  try {
    await aceRuntime().redis?.incr(VER_KEY);
  } catch {
    /* instanceهای دیگر حداکثر ۶۰ ثانیه بعد می‌فهمند */
  }
}

function rawLayers(c: Loaded): Record<string, unknown> {
  return {
    ...c.layers,
    engineMode: c.engineMode,
    storeOverrides: c.storeOverrides,
    audit: c.audit,
    revertedAt: c.revertedAt,
  };
}

function withAudit(c: Loaded, adminId: string | null, entries: Array<{ field: string; from: unknown; to: unknown }>): AceAuditEntry[] {
  const at = new Date().toISOString();
  return [...entries.map((e) => ({ at, adminId, ...e })), ...c.audit].slice(0, AUDIT_MAX);
}

export interface AceSettingsPatch {
  engineMode?: EngineMode;
  layers?: Partial<Record<LayerName, LayerMode>>;
  params?: Partial<AceParams>;
  // null = حذف استثنا
  storeOverride?: { storeId: string; mode: EngineMode | null };
}

export async function updateAceSettings(patch: AceSettingsPatch, adminId: string | null): Promise<void> {
  cached = null;
  const c = await load();
  const layers: Record<string, unknown> = rawLayers(c);
  const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
  let params = c.params;

  if (patch.engineMode && patch.engineMode !== c.engineMode) {
    changes.push({ field: 'engineMode', from: c.engineMode, to: patch.engineMode });
    layers.engineMode = patch.engineMode;
  }
  for (const [k, v] of Object.entries(patch.layers ?? {}) as [LayerName, LayerMode][]) {
    if (!(k in DEFAULT_LAYERS) || !['off', 'shadow', 'on'].includes(v)) continue;
    if (c.layers[k] !== v) {
      changes.push({ field: `layers.${k}`, from: c.layers[k], to: v });
      layers[k] = v;
    }
  }
  if (patch.storeOverride) {
    const { storeId, mode } = patch.storeOverride;
    const prev = c.storeOverrides[storeId] ?? null;
    if (prev !== mode) {
      const so = { ...c.storeOverrides };
      if (mode) so[storeId] = mode;
      else delete so[storeId];
      layers.storeOverrides = so;
      changes.push({ field: `storeOverrides.${storeId}`, from: prev, to: mode });
    }
  }
  if (patch.params) {
    const merged = { ...c.params, ...patch.params };
    for (const k of Object.keys(DEFAULT_PARAMS) as (keyof AceParams)[]) {
      if (merged[k] !== c.params[k]) changes.push({ field: `params.${k}`, from: c.params[k], to: merged[k] });
    }
    params = merged;
  }
  if (changes.length === 0) return;
  layers.audit = withAudit(c, adminId, changes);
  await persist({ layers, params });
}

// کلید اضطراری: engineMode=stable، استثناها خالی (نسخه‌ی قبلی در audit می‌ماند)، sticky نادیده گرفته می‌شود
export async function emergencyRevertToStable(adminId: string | null): Promise<void> {
  cached = null;
  const c = await load();
  const layers = rawLayers(c);
  layers.engineMode = 'stable';
  layers.storeOverrides = {};
  layers.revertedAt = Date.now();
  layers.audit = withAudit(c, adminId, [
    { field: 'emergencyRevert', from: { engineMode: c.engineMode, storeOverrides: c.storeOverrides }, to: { engineMode: 'stable', storeOverrides: {} } },
  ]);
  await persist({ layers, params: c.params });
}

// لغو آخرین «برگرداندن فوری» از روی audit
export async function undoEmergencyRevert(adminId: string | null): Promise<boolean> {
  cached = null;
  const c = await load();
  const last = c.audit.find((a) => a.field === 'emergencyRevert');
  if (!last) return false;
  const from = last.from as { engineMode?: EngineMode; storeOverrides?: Record<string, EngineMode> };
  const layers = rawLayers(c);
  layers.engineMode = isEngine(from.engineMode) ? from.engineMode : 'stable';
  layers.storeOverrides = from.storeOverrides ?? {};
  layers.audit = withAudit(c, adminId, [{ field: 'undoEmergencyRevert', from: { engineMode: c.engineMode }, to: { engineMode: layers.engineMode } }]);
  await persist({ layers, params: c.params });
  return true;
}
