import type Redis from 'ioredis';

// ACE — دسترسی بدون DI به Redis/Prisma برای توابع کش (تا سازنده‌ی سرویس‌های موجود عوض نشود).
// I-6: هر جا ست نشده باشد (تست، بوت ناقص) همه‌ی لایه‌ها fail-open می‌شوند.
export interface AceRuntime {
  redis: Pick<Redis, 'get' | 'set' | 'incr' | 'del' | 'expire'> | null;
  loadConfig: (() => Promise<{ layers?: unknown; params?: unknown } | null>) | null;
  saveConfig: ((data: { layers: unknown; params: unknown }) => Promise<void>) | null;
}

const runtime: AceRuntime = { redis: null, loadConfig: null, saveConfig: null };

export function setAceRuntime(patch: Partial<AceRuntime>): void {
  Object.assign(runtime, patch);
}

export function aceRuntime(): AceRuntime {
  return runtime;
}
