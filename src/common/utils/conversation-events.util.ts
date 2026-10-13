import type { ConversationEvent } from '@prisma/client';
import { CONVERSATION_EVENTS_PAGE_SIZE } from '../constants/sales-ops.constants';
import type { PrismaService } from '../../prisma/prisma.service';

// PRD-nivo-sales-unified.md تسک 0.6 — قبلاً `orderBy asc, take 50` قدیمی‌ترین ۵۰ رویداد را
// می‌داد؛ مکالمه‌ی بلند «آخرین پیام» را هرگز نشان نمی‌داد. حالا جدیدترین‌ها (به ترتیب زمانی)،
// و `before` (ISO createdAt قدیمی‌ترین رویداد دیده‌شده) صفحه‌ی قدیمی‌تر را می‌دهد.
export async function getRecentConversationEvents(
  prisma: Pick<PrismaService, 'conversationEvent'>,
  conversationId: string,
  before?: string,
): Promise<{ events: ConversationEvent[]; hasMoreEvents: boolean }> {
  const beforeDate = before ? new Date(before) : undefined;
  const cursor =
    beforeDate && !Number.isNaN(beforeDate.getTime()) ? beforeDate : undefined;
  const rows = await prisma.conversationEvent.findMany({
    where: { conversationId, ...(cursor ? { createdAt: { lt: cursor } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: CONVERSATION_EVENTS_PAGE_SIZE + 1,
  });
  const hasMoreEvents = rows.length > CONVERSATION_EVENTS_PAGE_SIZE;
  return {
    events: rows.slice(0, CONVERSATION_EVENTS_PAGE_SIZE).reverse(),
    hasMoreEvents,
  };
}
