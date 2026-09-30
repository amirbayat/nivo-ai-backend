import type { ConversationContext } from './sales-agent.types';

// docs/PRD-conversation-history.md بخش ۳ — منبع مشترک وب+تلگرام، تا منطق وضعیت/آخرین محصول
// یک‌بار نوشته شود و هر دو کانال دقیقاً همان چیز را نشان دهند
export type ConversationHistoryStatus =
  'COMPLETED' | 'REJECTED' | 'IN_PROGRESS' | 'NEEDS_ATTENTION';

export interface ConversationHistoryEntry {
  conversationId: string;
  storeName: string;
  lastProductName: string | null;
  status: ConversationHistoryStatus;
  updatedAt: Date;
}

interface HistorySourceConversation {
  id: string;
  currentState: string;
  isMutedForHuman: boolean;
  contextData: unknown;
  updatedAt: Date;
}

function statusFor(c: HistorySourceConversation): ConversationHistoryStatus {
  if (c.currentState === 'COMPLETED') return 'COMPLETED';
  if (c.currentState === 'REJECTED') return 'REJECTED';
  if (c.isMutedForHuman || c.currentState === 'HANDOFF_HUMAN')
    return 'NEEDS_ATTENTION';
  return 'IN_PROGRESS';
}

export function buildHistoryEntry(
  c: HistorySourceConversation,
  storeName: string,
): ConversationHistoryEntry {
  const ctx = c.contextData as ConversationContext | null;
  // اولین آیتم = محصولی که واقعاً به مشتری نشان/معرفی شده (همان اندیسی که applyCartUpdate
  // برای «همینو بده»/ارجاع بدون اسم استفاده می‌کند)، نه آخرین آیتم آرایه‌ی نتایج جست‌وجو
  const lastProductName = ctx?.lastShownProducts?.[0]?.name ?? null;
  return {
    conversationId: c.id,
    storeName,
    lastProductName,
    status: statusFor(c),
    updatedAt: c.updatedAt,
  };
}
