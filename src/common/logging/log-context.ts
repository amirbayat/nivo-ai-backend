import { AsyncLocalStorage } from 'async_hooks';

// R1.3 — هر لاگ مسیر چت conversationId و storeId دارد، بدون دست‌زدن به هر logger.* جداگانه:
// نقطه‌های ورود چت (loadOwned، تلگرام، موتور) setLogCtx صدا می‌زنند و CtxLogger آن را به همه‌ی
// لاگ‌های همان درخواست اضافه می‌کند.
interface LogCtx {
  conversationId?: string;
  storeId?: string;
}

const storage = new AsyncLocalStorage<LogCtx>();

export function setLogCtx(ctx: LogCtx): void {
  const current = storage.getStore();
  if (current) Object.assign(current, ctx);
  else storage.enterWith({ ...ctx });
}

export function logCtx(): string {
  const ctx = storage.getStore();
  if (!ctx?.conversationId && !ctx?.storeId) return '';
  return `[conversationId=${ctx.conversationId ?? '-'} storeId=${ctx.storeId ?? '-'}]`;
}
