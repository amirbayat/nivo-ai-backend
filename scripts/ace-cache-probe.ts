/* eslint-disable no-console */
// ACE-2 گام صفر: آیا هر مدل واقعاً prompt caching می‌دهد؟
// اجرا: npx ts-node -r dotenv/config scripts/ace-cache-probe.ts   (کلید و base URL از .env؛ از شبکه‌ای که به OpenRouter/relay می‌رسد)
// برای هر مدل دو درخواست پشت‌سرهم با prefix ثابت ~۳۰۰۰ توکنی (با cache_control برای anthropic، بدون آن برای بقیه)
// و گزارش cached_tokens و cost درخواست دوم.
import { MODEL_VARIANTS, PERCEPTION_MODEL } from '../src/modules/sales-agent/model-variants';

const BASE = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const KEY = process.env.OPENROUTER_API_KEY ?? '';
const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${KEY}` };
if (process.env.OPENROUTER_RELAY_SECRET) headers['X-Relay-Secret'] = process.env.OPENROUTER_RELAY_SECRET;

// prefix فارسی/انگلیسی ثابت و بی‌timestamp، بلندتر از حداقل prefix همه‌ی providerها
const RULES = Array.from({ length: 220 }, (_, i) => `قانون ${i + 1}: در جواب به مشتری فروشگاه، مؤدب و کوتاه باش و فقط از اطلاعات داده‌شده استفاده کن و قیمت را حدس نزن.`).join('\n');

async function call(model: string, withCacheControl: boolean, sessionId: string) {
  const system = withCacheControl
    ? [{ type: 'text', text: RULES, cache_control: { type: 'ephemeral' } }]
    : RULES;
  const t = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      session_id: sessionId,
      max_tokens: 8,
      temperature: 0,
      usage: { include: true },
      messages: [{ role: 'system', content: system }, { role: 'user', content: 'سلام، فقط بگو باشه.' }],
    }),
  });
  const j = (await res.json()) as { usage?: { prompt_tokens?: number; cost?: number; prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } }; error?: unknown };
  if (!res.ok) throw new Error(JSON.stringify(j.error ?? j).slice(0, 200));
  return { ms: Date.now() - t, prompt: j.usage?.prompt_tokens, cached: j.usage?.prompt_tokens_details?.cached_tokens ?? 0, write: j.usage?.prompt_tokens_details?.cache_write_tokens ?? 0, cost: j.usage?.cost };
}

async function main() {
  if (!KEY) throw new Error('OPENROUTER_API_KEY ست نیست');
  const models = [...new Set([...Object.values(MODEL_VARIANTS), PERCEPTION_MODEL])];
  const nonce = `probe-${Date.now()}`; // prefix هر اجرا تازه باشد تا cache اجرای قبلی نتیجه را کج نکند
  for (const model of models) {
    const sid = `${nonce}-${model}`;
    try {
      const anth = model.startsWith('anthropic/');
      // nonce داخل system نمی‌رود (prefix باید ثابت بماند)؛ فقط اولین درخواست write می‌کند
      const a = await call(model, anth, sid);
      const b = await call(model, anth, sid);
      const verdict = b.cached > 0 ? 'CACHE OK' : 'NO CACHE';
      console.log(`${verdict.padEnd(9)} ${model.padEnd(34)} prompt=${b.prompt} 1st(cached=${a.cached},write=${a.write},cost=${a.cost}) 2nd(cached=${b.cached},cost=${b.cost}) ${b.ms}ms`);
    } catch (e) {
      console.log(`ERROR     ${model.padEnd(34)} ${(e as Error).message}`);
    }
  }
}
void main();
