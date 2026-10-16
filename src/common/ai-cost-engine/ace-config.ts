import { aceRuntime } from './ace-runtime';

export type LayerName =
  | 'promptCache' | 'memo' | 'embedCache' | 'subcallDiet' | 'loopDiet' | 'dedupe'
  | 'offTopicBudget' | 'fastAnswers' | 'semanticCache' | 'ttsCache';
export type LayerMode = 'off' | 'shadow' | 'on';

// پیش‌فرض امن: همه off (بخش ۹ سند). لایه‌ای که متن جواب را عوض می‌کند هرگز پیش‌فرض on نیست.
export const DEFAULT_LAYERS: Record<LayerName, LayerMode> = {
  promptCache: 'off', memo: 'off', embedCache: 'off', subcallDiet: 'off', loopDiet: 'off',
  dedupe: 'off', offTopicBudget: 'off', fastAnswers: 'off', semanticCache: 'off', ttsCache: 'off',
};
export const DEFAULT_PARAMS = {
  memoTtlSec: 3600,
  embeddingTtlSec: 7 * 24 * 3600,
  dedupeWindowSec: 30,
  offTopicMax: 3,
};
export type AceParams = typeof DEFAULT_PARAMS;

const CACHE_MS = 60_000;
let cached: { at: number; layers: Record<LayerName, LayerMode>; params: AceParams } | null = null;
let warned = false;

export function resetAceConfigCache(): void {
  cached = null;
}

async function load() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached;
  let layers = { ...DEFAULT_LAYERS };
  let params = { ...DEFAULT_PARAMS };
  try {
    const row = await aceRuntime().loadConfig?.();
    if (row) {
      const l = (row.layers ?? {}) as Record<string, unknown>;
      for (const k of Object.keys(DEFAULT_LAYERS) as LayerName[]) {
        if (l[k] === 'off' || l[k] === 'shadow' || l[k] === 'on') layers[k] = l[k] as LayerMode;
      }
      params = { ...params, ...((row.params ?? {}) as Partial<AceParams>) };
    }
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn(`[ACE] config table unavailable, defaults used: ${(err as Error).message}`);
    }
  }
  cached = { at: Date.now(), layers, params };
  return cached;
}

export async function layerMode(name: LayerName): Promise<LayerMode> {
  return (await load()).layers[name];
}

export async function aceParams(): Promise<AceParams> {
  return (await load()).params;
}
