import { PrismaService } from '../../prisma/prisma.service';

// docs/PRD-sales-agent-admin-analytics.md بخش ۴ + docs/PRD-sales-agent-voice.md بخش ۶.۱ —
// همان محاسبه‌ی آمار A/B مدل، فقط با بعد گروه‌بندی دیگر (کانال یا A/B وویس به‌جای مدل).
// مشترک بین AdminService (مقایسه‌ی cross-store، ادمین) و StoreService (نسخه‌ی کوچک‌تر همین
// کارت در پنل خودِ فروشنده، بدون فیلتر مدل).
export type StatsGroupBy = 'variant' | 'channel' | 'voiceVariant';

export interface ConversationStatRow {
  group: string;
  conversations: number;
  avgClarifyAttempts: number;
  stuckHandoffRate: number;
  approvedOrderRate: number;
  aiCalls: number;
  fallbackRate: number;
  avgLatencyMs: number;
}

export async function getStuckConversationIds(
  prisma: PrismaService,
  conversationIds: string[],
): Promise<Set<string>> {
  if (conversationIds.length === 0) return new Set();
  const toolCallEvents = await prisma.conversationEvent.findMany({
    where: { conversationId: { in: conversationIds }, type: 'TOOL_CALL' },
    select: { conversationId: true, payload: true },
  });
  return new Set(
    toolCallEvents
      .filter(
        (e) => (e.payload as { toolName?: string })?.toolName === 'AGENT_STUCK',
      )
      .map((e) => e.conversationId),
  );
}

export async function computeConversationStats(
  prisma: PrismaService,
  params: {
    storeId?: string;
    from?: Date;
    to?: Date;
    groupBy?: StatsGroupBy;
  } = {},
): Promise<ConversationStatRow[]> {
  const groupBy = params.groupBy ?? 'variant';

  const conversations = await prisma.salesConversation.findMany({
    where: {
      ...(groupBy === 'variant' ? { abVariant: { not: null } } : {}),
      ...(params.storeId ? { storeId: params.storeId } : {}),
      ...((params.from ?? params.to)
        ? {
            createdAt: {
              ...(params.from ? { gte: params.from } : {}),
              ...(params.to ? { lte: params.to } : {}),
            },
          }
        : {}),
    },
    select: {
      id: true,
      abVariant: true,
      voiceVariant: true,
      clarifyAttempts: true,
      customer: { select: { channel: true } },
    },
  });
  if (conversations.length === 0) return [];

  const groupKeyOf = (c: (typeof conversations)[number]): string | null => {
    if (groupBy === 'channel') return c.customer.channel;
    if (groupBy === 'voiceVariant') return c.voiceVariant;
    return c.abVariant;
  };

  const conversationIds = conversations.map((c) => c.id);
  const groupByConversationId = new Map(
    conversations.map((c) => [c.id, groupKeyOf(c)]),
  );

  const stuckConversationIds = await getStuckConversationIds(
    prisma,
    conversationIds,
  );

  const approvedOrders = await prisma.order.findMany({
    where: { conversationId: { in: conversationIds }, status: 'APPROVED' },
    select: { conversationId: true },
  });
  const approvedConversationIds = new Set(
    approvedOrders.map((o) => o.conversationId),
  );

  const metrics = await prisma.abModelMetric.findMany({
    where: { conversationId: { in: conversationIds } },
    select: {
      conversationId: true,
      variant: true,
      success: true,
      latencyMs: true,
    },
  });

  type Bucket = {
    conversations: number;
    totalClarifyAttempts: number;
    stuckHandoffs: number;
    approvedOrders: number;
    aiCalls: number;
    failedCalls: number;
    totalLatencyMs: number;
  };
  const byGroup = new Map<string, Bucket>();
  const bucket = (key: string): Bucket => {
    let b = byGroup.get(key);
    if (!b) {
      b = {
        conversations: 0,
        totalClarifyAttempts: 0,
        stuckHandoffs: 0,
        approvedOrders: 0,
        aiCalls: 0,
        failedCalls: 0,
        totalLatencyMs: 0,
      };
      byGroup.set(key, b);
    }
    return b;
  };

  for (const c of conversations) {
    const key = groupKeyOf(c);
    if (!key) continue;
    const b = bucket(key);
    b.conversations++;
    b.totalClarifyAttempts += c.clarifyAttempts;
    if (stuckConversationIds.has(c.id)) b.stuckHandoffs++;
    if (approvedConversationIds.has(c.id)) b.approvedOrders++;
  }
  for (const m of metrics) {
    const key =
      groupBy === 'variant'
        ? m.variant
        : groupByConversationId.get(m.conversationId);
    if (!key) continue;
    const b = bucket(key);
    b.aiCalls++;
    if (!m.success) b.failedCalls++;
    b.totalLatencyMs += m.latencyMs;
  }

  return Array.from(byGroup.entries())
    .map(([group, b]) => ({
      group,
      conversations: b.conversations,
      avgClarifyAttempts: b.conversations
        ? b.totalClarifyAttempts / b.conversations
        : 0,
      stuckHandoffRate: b.conversations ? b.stuckHandoffs / b.conversations : 0,
      approvedOrderRate: b.conversations
        ? b.approvedOrders / b.conversations
        : 0,
      aiCalls: b.aiCalls,
      fallbackRate: b.aiCalls ? b.failedCalls / b.aiCalls : 0,
      avgLatencyMs: b.aiCalls ? Math.round(b.totalLatencyMs / b.aiCalls) : 0,
    }))
    .sort((a, b) => a.group.localeCompare(b.group));
}
