import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

// ACE-0 — context سبک برای ledger: یک turnId برای همه‌ی callهای یک پیام خریدار + callSite/store/conversation.
// عمداً جدا از LlmTurnContext (guard) تا آن فایل فقط یک hook کوچک بگیرد.
export interface AceContext {
  turnId: string;
  callSite?: string;
  storeId?: string;
  conversationId?: string;
  // موتور این گفتگو (بخش ۱.۵)؛ نبودنش = stable
  engine?: 'stable' | 'lean';
}

const storage = new AsyncLocalStorage<AceContext>();

export function getAceContext(): AceContext | undefined {
  return storage.getStore();
}

// turn تودرتو همان turnId بیرونی را نگه می‌دارد
export function runWithAceTurn<T>(fn: () => T, init: Partial<AceContext> = {}): T {
  const cur = storage.getStore();
  if (cur) return storage.run({ ...cur, ...init, turnId: cur.turnId }, fn);
  return storage.run({ turnId: randomUUID(), ...init }, fn);
}

// برچسب call site برای callهای داخل fn (مثلاً 'faq_pick'). بدون turn هم کار می‌کند.
export function withCallSite<T>(callSite: string, fn: () => T, extra: Partial<AceContext> = {}): T {
  const cur = storage.getStore();
  return storage.run({ turnId: cur?.turnId ?? randomUUID(), ...cur, ...extra, callSite }, fn);
}

// برچسب‌گذاری درجا (برای نقاطی که لفاف‌کردن call دشوار است): تا برچسب بعدی همین نوبت معتبر است.
// در callهای موازی در یک نوبت ممکن است دقیق نباشد؛ برای ledger قابل‌قبول است.
export function setCallSite(callSite: string): void {
  const cur = storage.getStore();
  if (cur) cur.callSite = callSite;
}
