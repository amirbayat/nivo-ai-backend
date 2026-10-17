import { getAceContext } from './ace-context';
import { ledgerEnabledSync } from './ace-config';
import { recordAiCall } from './ledger-sink';

type OpenAiUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
};

const METERED_PATHS = ['/chat/completions', '/embeddings'];

export function isMeteredUrl(url: string): boolean {
  return METERED_PATHS.some((p) => url.includes(p));
}

export function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return (input as { url?: string } | undefined)?.url ?? '';
}

function modelOf(body: unknown): string | null {
  if (typeof body !== 'string') return null;
  try {
    return (JSON.parse(body) as { model?: string }).model ?? null;
  } catch {
    return null;
  }
}

// آخرین usage در بدنه‌ی JSON یا در SSE (آخرین chunk دارای usage)
export function extractUsage(text: string): { usage?: OpenAiUsage; model?: string } {
  const t = text.trim();
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t) as { usage?: OpenAiUsage; model?: string };
      return { usage: j.usage, model: j.model };
    } catch {
      return {};
    }
  }
  let usage: OpenAiUsage | undefined;
  let model: string | undefined;
  for (const line of t.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const j = JSON.parse(payload) as { usage?: OpenAiUsage; model?: string };
      if (j.usage) usage = j.usage;
      if (j.model) model = j.model;
    } catch {
      /* chunk ناقص */
    }
  }
  return { usage, model };
}

// ACE-0 — بعد از هر call مدل، یک ردیف ledger. روی clone پاسخ کار می‌کند تا stream اصلی دست‌نخورده بماند؛
// هر خطایی بی‌صدا نادیده گرفته می‌شود.
export function meterResponse(input: unknown, init: RequestInit | undefined, res: Response, startedAt: number): void {
  try {
    // layers.ledger=off → meter کاملاً دور زده می‌شود (حتی res.clone() صدا نمی‌شود)
    if (!ledgerEnabledSync()) return;
    const url = urlOf(input);
    if (!isMeteredUrl(url)) return;
    // snapshot همین لحظه: setCallSite درجا عوض می‌شود و then بعداً اجرا می‌شود
    const ctx = { ...getAceContext() } as ReturnType<typeof getAceContext>;
    const requestModel = modelOf(init?.body);
    const clone = res.clone();
    void clone
      .text()
      .then((text) => {
        const { usage, model } = extractUsage(text);
        recordAiCall({
          storeId: ctx?.storeId,
          conversationId: ctx?.conversationId,
          turnId: ctx?.turnId,
          callSite: ctx?.callSite ?? 'untagged',
          servedBy: 'llm',
          model: model ?? requestModel,
          inputTokens: usage?.prompt_tokens ?? 0,
          cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
          cacheWriteTokens: usage?.prompt_tokens_details?.cache_write_tokens ?? 0,
          outputTokens: usage?.completion_tokens ?? 0,
          reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
          steps: 1,
          costUsdMicros: typeof usage?.cost === 'number' ? Math.round(usage.cost * 1e6) : 0,
          costIsEstimate: typeof usage?.cost !== 'number',
          latencyMs: Date.now() - startedAt,
          meta: {
            engineMode: ctx?.engine ?? 'stable',
            ...(ctx?.callSite ? {} : { urlPath: url.replace(/^https?:\/\/[^/]+/, '').slice(0, 80) }),
          },
        });
      })
      .catch(() => undefined);
  } catch {
    /* best-effort */
  }
}
