// ACE-0 — نقطه‌ی ثبت بدون DI برای fetch-meter (که داخل تابع خالص guardFetch است).
export interface LedgerEntry {
  storeId?: string | null;
  conversationId?: string | null;
  turnId?: string | null;
  callSite: string;
  servedBy: 'llm' | 'memo' | 'semantic' | 'deterministic' | 'dedupe' | 'single_flight';
  model?: string | null;
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  steps?: number;
  costUsdMicros?: number;
  costIsEstimate?: boolean;
  avoidedUsdMicros?: number;
  latencyMs?: number;
  meta?: Record<string, unknown> | null;
}

let sink: ((e: LedgerEntry) => void) | null = null;

export function setLedgerSink(fn: ((e: LedgerEntry) => void) | null): void {
  sink = fn;
}

// هرگز throw نمی‌کند: ثبت ledger نباید نوبت را خراب کند
export function recordAiCall(entry: LedgerEntry): void {
  try {
    sink?.(entry);
  } catch {
    /* best-effort */
  }
}
