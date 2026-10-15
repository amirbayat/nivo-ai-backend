import { AsyncLocalStorage } from 'async_hooks';
import { generateText, streamText } from 'ai';
import type { UiBlock } from './sales-agent.types';
import { fa } from '../../i18n/fa';

export type ShopTurnEvent =
  | { type: 'status'; text: string }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      reply: string;
      uiBlocks: UiBlock[];
      state: string;
      quickReplies?: string[];
      voiceEventId?: string;
      awaitingReview: boolean;
      queued?: boolean;
    }
  | { type: 'error' };

type Sink = {
  emit: (event: ShopTurnEvent) => void;
  noteFirstToken: () => void;
  turnId: string;
};

const sinkStorage = new AsyncLocalStorage<Sink>();

type TurnBuf = {
  events: ShopTurnEvent[];
  waiters: Array<() => void>;
  closed: boolean;
};

const turns = new Map<string, TurnBuf>();
const turnTimers = new Map<string, ReturnType<typeof setTimeout>>();

// TODO(product): this buffer is process-local. If the Darkube backend app runs
// more than one replica, move it to Redis pub/sub plus a short list. Do that
// only after the replica count is known.

function armTurnExpiry(turnId: string) {
  const existing = turnTimers.get(turnId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    turnTimers.delete(turnId);
    turns.delete(turnId);
  }, 120_000);
  timer.unref?.();
  turnTimers.set(turnId, timer);
}

export function openShopTurn(turnId: string, onFirstToken: () => void): Sink {
  const buf: TurnBuf = { events: [], waiters: [], closed: false };
  turns.set(turnId, buf);
  armTurnExpiry(turnId);
  let noted = false;
  const sink: Sink = {
    turnId,
    emit(event) {
      buf.events.push(event);
      const waiters = buf.waiters.splice(0);
      for (const wake of waiters) wake();
    },
    noteFirstToken() {
      if (noted) return;
      noted = true;
      onFirstToken();
    },
  };
  return sink;
}

export function closeShopTurn(turnId: string) {
  const buf = turns.get(turnId);
  if (!buf) return;
  const timer = turnTimers.get(turnId);
  if (timer) clearTimeout(timer);
  turnTimers.delete(turnId);
  if (!buf.closed) {
    buf.closed = true;
    const waiters = buf.waiters.splice(0);
    for (const wake of waiters) wake();
  }
  armTurnExpiry(turnId);
}

export async function* listenShopTurn(turnId: string): AsyncGenerator<ShopTurnEvent> {
  const buf = turns.get(turnId);
  if (!buf) return;
  let index = 0;
  let waiting: (() => void) | null = null;
  try {
    while (true) {
      while (index < buf.events.length) yield buf.events[index++];
      if (buf.closed) return;
      await new Promise<void>((resolve) => {
        waiting = resolve;
        buf.waiters.push(resolve);
      });
      waiting = null;
    }
  } finally {
    if (waiting) {
      const at = buf.waiters.indexOf(waiting);
      if (at >= 0) buf.waiters.splice(at, 1);
    }
  }
}

export function runWithShopTurn<T>(sink: Sink, fn: () => Promise<T>): Promise<T> {
  return sinkStorage.run(sink, fn);
}

export function runOutsideShopTurn<T>(fn: () => Promise<T>): Promise<T> {
  return sinkStorage.exit(fn);
}

export function isInsideShopTurn(): boolean {
  return sinkStorage.getStore() != null;
}

export function currentShopTurnId(): string | undefined {
  return sinkStorage.getStore()?.turnId;
}

const TOOL_STATUS: Record<string, string> = {
  search_products: fa.salesAgent.streamSearch,
  check_stock: fa.salesAgent.streamStock,
  update_cart: fa.salesAgent.streamCart,
  get_product_details: fa.salesAgent.streamDetails,
};

export function extractRespondText(partial: string): string | null {
  const key = '"text"';
  const at = partial.indexOf(key);
  if (at < 0) return null;
  let i = partial.indexOf(':', at + key.length);
  if (i < 0) return null;
  i += 1;
  while (partial[i] === ' ' || partial[i] === '\n') i += 1;
  if (partial[i] !== '"') return null;
  i += 1;
  let out = '';
  while (i < partial.length) {
    const ch = partial[i];
    if (ch === '\\') {
      const next = partial[i + 1];
      if (next === undefined) return out;
      if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next === '"') out += '"';
      else if (next === '\\') out += '\\';
      else out += next;
      i += 2;
      continue;
    }
    if (ch === '"') return out;
    out += ch;
    i += 1;
  }
  return out;
}

type ShopModelArgs = Parameters<typeof generateText>[0];

export type ShopTurnModelResult = {
  toolCalls: Array<{ toolName: string; input?: Record<string, unknown> }>;
  usage: { inputTokens?: number; outputTokens?: number };
  steps: unknown[];
};

export async function generateShopTurn(args: ShopModelArgs): Promise<ShopTurnModelResult> {
  const sink = sinkStorage.getStore();
  if (!sink) {
    const result = await generateText(args);
    return {
      toolCalls: result.toolCalls as ShopTurnModelResult['toolCalls'],
      usage: result.usage,
      steps: result.steps,
    };
  }

  const result = streamText(args as Parameters<typeof streamText>[0]);
  const names = new Map<string, string>();
  const partials = new Map<string, string>();
  let streamed = '';
  for await (const part of result.stream) {
    if (part.type === 'tool-input-start' && part.toolName !== 'respond_to_customer') {
      names.set(part.id, part.toolName);
      sink.emit({
        type: 'status',
        text: TOOL_STATUS[part.toolName] ?? fa.salesAgent.streamLooking,
      });
    } else if (part.type === 'tool-input-start') {
      names.set(part.id, part.toolName);
    } else if (part.type === 'tool-input-delta') {
      if (names.get(part.id) !== 'respond_to_customer') continue;
      const acc = (partials.get(part.id) ?? '') + part.delta;
      partials.set(part.id, acc);
      const text = extractRespondText(acc);
      if (text && text !== streamed) {
        streamed = text;
        sink.noteFirstToken();
        sink.emit({ type: 'delta', text });
      }
    }
  }
  const [toolCalls, usage, steps] = await Promise.all([
    result.toolCalls,
    result.usage,
    result.steps,
  ]);
  return {
    toolCalls: toolCalls as ShopTurnModelResult['toolCalls'],
    usage,
    steps,
  };
}
