import { AsyncLocalStorage } from 'async_hooks';
import {
  LLM_CALL_TIMEOUT_MS,
  LLM_GLOBAL_CONCURRENCY,
  LLM_QUEUE_MAX_WAITING,
  LLM_TURN_DEADLINE_MS,
} from '../constants/sales-ops.constants';

// 2.1 — محافظ call های LLM موتور فروش. به‌جای دست‌زدن به ~۱۶ نقطه‌ی call، همه از
// AiProviderService.buildClient رد می‌شوند و fetch آن از اینجا می‌گذرد. فقط وقتی «context
// turn» فعال باشد (runLlmTurn) اعمال می‌شود؛ بقیه‌ی مصرف‌کننده‌های buildClient (چت اصلی،
// استریم، ...) دقیقاً مثل قبل رد می‌شوند.

export class LlmDeadlineError extends Error {
  constructor() {
    super('llm turn deadline exceeded');
  }
}
export class LlmSaturatedError extends Error {
  constructor() {
    super('llm concurrency saturated');
  }
}

interface LlmTurnContext {
  deadlineAt: number;
}

const storage = new AsyncLocalStorage<LlmTurnContext>();

export function runLlmTurn<T>(
  fn: () => Promise<T>,
  deadlineMs = LLM_TURN_DEADLINE_MS,
): Promise<T> {
  // turn تودرتو (مثلاً drain داخل handleMessage) deadline بیرونی را نگه می‌دارد
  if (storage.getStore()) return fn();
  return storage.run({ deadlineAt: Date.now() + deadlineMs }, fn);
}

export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly max: number,
    private readonly maxWaiting: number,
  ) {}

  get isSaturated(): boolean {
    return this.active >= this.max && this.waiters.length >= this.maxWaiting;
  }

  get stats() {
    return { active: this.active, waiting: this.waiters.length };
  }

  async acquire(timeoutMs: number): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    if (this.waiters.length >= this.maxWaiting) throw new LlmSaturatedError();
    await new Promise<void>((resolve, reject) => {
      const waiter = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new LlmDeadlineError());
      }, timeoutMs);
      this.waiters.push(waiter);
    });
    // نوبت از release منتقل شده: slot همان‌جا به این waiter داده شده (active تغییر نمی‌کند)
    return () => this.release();
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active--;
  }
}

export const llmSemaphore = new Semaphore(
  LLM_GLOBAL_CONCURRENCY,
  LLM_QUEUE_MAX_WAITING,
);

export function isLlmSaturated(): boolean {
  return llmSemaphore.isSaturated;
}

type FetchFn = typeof globalThis.fetch;

export function guardFetch(inner: FetchFn | undefined): FetchFn {
  return (async (input: Parameters<FetchFn>[0], init?: RequestInit) => {
    const call = inner ?? globalThis.fetch;
    const ctx = storage.getStore();
    if (!ctx) return call(input, init);

    const remaining = ctx.deadlineAt - Date.now();
    if (remaining <= 0) throw new LlmDeadlineError();
    const release = await llmSemaphore.acquire(remaining);
    try {
      const left = ctx.deadlineAt - Date.now();
      if (left <= 0) throw new LlmDeadlineError();
      const signals = [
        AbortSignal.timeout(Math.min(LLM_CALL_TIMEOUT_MS, left)),
      ];
      if (init?.signal) signals.push(init.signal);
      return await call(input, { ...init, signal: AbortSignal.any(signals) });
    } finally {
      release();
    }
  }) as FetchFn;
}
