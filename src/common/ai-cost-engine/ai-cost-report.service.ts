import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const num = (v: unknown): number => (typeof v === 'bigint' ? Number(v) : Number(v ?? 0));
const usd = (micros: unknown): number => num(micros) / 1e6;

// بخش ۲.۴ — گزارش‌های تب «هزینه» و «مقایسه». فقط خواندنی؛ جدول نبود → ready=false (UI پیام می‌دهد).
@Injectable()
export class AiCostReportService {
  constructor(private readonly prisma: PrismaService) {}

  private since(days: number): Date {
    return new Date(Date.now() - Math.min(Math.max(days, 1), 90) * 24 * 3600 * 1000);
  }

  async costReport(days: number) {
    const from = this.since(days);
    try {
      const [totals] = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT COUNT(*) AS rows,
               COALESCE(SUM("costUsdMicros") FILTER (WHERE NOT "costIsEstimate"),0) AS real_cost,
               COALESCE(SUM("costUsdMicros") FILTER (WHERE "costIsEstimate"),0) AS est_cost,
               COUNT(*) FILTER (WHERE "costIsEstimate") AS est_rows,
               COALESCE(SUM("costUsdMicros") FILTER (WHERE "callSite"='untagged'),0) AS untagged_cost,
               COALESCE(SUM("avoidedUsdMicros"),0) AS avoided,
               COALESCE(SUM("inputTokens") FILTER (WHERE "callSite"='main_loop'),0) AS loop_in,
               COALESCE(SUM("cachedInputTokens") FILTER (WHERE "callSite"='main_loop'),0) AS loop_cached,
               COUNT(DISTINCT "conversationId") AS conversations,
               COUNT(DISTINCT "turnId") AS turns
        FROM ai_call_ledger WHERE "createdAt" >= ${from}`);

      const bySite = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT "callSite", COALESCE(model,'-') AS model, COUNT(*) AS calls,
               COALESCE(SUM("costUsdMicros"),0) AS cost,
               ROUND(AVG("inputTokens")) AS avg_in, ROUND(AVG("outputTokens")) AS avg_out,
               COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs"),0) AS p95_latency,
               COUNT(*) FILTER (WHERE "costUsdMicros"=0) AS zero_cost_rows
        FROM ai_call_ledger WHERE "createdAt" >= ${from}
        GROUP BY 1,2 ORDER BY cost DESC LIMIT 60`);

      const daily = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT to_char(date_trunc('day',"createdAt"),'YYYY-MM-DD') AS day,
               COALESCE(SUM("costUsdMicros"),0) AS cost, COUNT(*) AS calls
        FROM ai_call_ledger WHERE "createdAt" >= ${from} GROUP BY 1 ORDER BY 1`);

      const servedBy = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT "servedBy", COUNT(*) AS calls, COALESCE(SUM("costUsdMicros"),0) AS cost,
               COALESCE(SUM("avoidedUsdMicros"),0) AS avoided
        FROM ai_call_ledger WHERE "createdAt" >= ${from} GROUP BY 1 ORDER BY calls DESC`);

      const topConversations = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT "conversationId", MAX("storeId") AS store_id, COALESCE(SUM("costUsdMicros"),0) AS cost,
               COUNT(DISTINCT "turnId") AS turns, COUNT(*) AS calls
        FROM ai_call_ledger WHERE "createdAt" >= ${from} AND "conversationId" IS NOT NULL
        GROUP BY 1 ORDER BY cost DESC LIMIT 20`);

      const topStores = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT l."storeId", COALESCE(MAX(s.name),'—') AS name, COALESCE(SUM(l."costUsdMicros"),0) AS cost,
               COUNT(DISTINCT l."conversationId") AS conversations
        FROM ai_call_ledger l LEFT JOIN stores s ON s.id = l."storeId"
        WHERE l."createdAt" >= ${from} AND l."storeId" IS NOT NULL
        GROUP BY 1 ORDER BY cost DESC LIMIT 20`);

      const [perConv] = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY c),0) AS median, COALESCE(percentile_cont(0.9) WITHIN GROUP (ORDER BY c),0) AS p90
        FROM (SELECT SUM("costUsdMicros") AS c FROM ai_call_ledger
              WHERE "createdAt" >= ${from} AND "conversationId" IS NOT NULL GROUP BY "conversationId") t`);

      const rows = num(totals?.rows);
      const loopIn = num(totals?.loop_in);
      return {
        ready: true,
        days,
        cards: {
          rows,
          conversations: num(totals?.conversations),
          turns: num(totals?.turns),
          realCostUsd: usd(totals?.real_cost),
          estimatedCostUsd: usd(totals?.est_cost),
          estimatedRowsPct: rows ? num(totals?.est_rows) / rows : 0,
          untaggedCostPct: usd(totals?.real_cost) + usd(totals?.est_cost) > 0
            ? usd(totals?.untagged_cost) / (usd(totals?.real_cost) + usd(totals?.est_cost)) : 0,
          cacheReadRate: loopIn ? num(totals?.loop_cached) / loopIn : 0,
          medianConversationCostUsd: usd(perConv?.median),
          p90ConversationCostUsd: usd(perConv?.p90),
          avoidedEstimatedUsd: usd(totals?.avoided),
        },
        bySite: bySite.map((r) => ({
          callSite: r.callSite, model: r.model, calls: num(r.calls), costUsd: usd(r.cost),
          avgIn: num(r.avg_in), avgOut: num(r.avg_out), p95LatencyMs: Math.round(num(r.p95_latency)), zeroCostRows: num(r.zero_cost_rows),
        })),
        daily: daily.map((r) => ({ day: r.day, costUsd: usd(r.cost), calls: num(r.calls) })),
        servedBy: servedBy.map((r) => ({ servedBy: r.servedBy, calls: num(r.calls), costUsd: usd(r.cost), avoidedUsd: usd(r.avoided) })),
        topConversations: topConversations.map((r) => ({ conversationId: r.conversationId, storeId: r.store_id, costUsd: usd(r.cost), turns: num(r.turns), calls: num(r.calls) })),
        topStores: topStores.map((r) => ({ storeId: r.storeId, name: r.name, costUsd: usd(r.cost), conversations: num(r.conversations) })),
      };
    } catch (err) {
      return { ready: false, error: (err as Error).message.slice(0, 200) };
    }
  }

  // مقایسه‌ی پایدار/بهینه روی گفتگوهای دارای ledger؛ فقط عدد خام (هزینه/توکن/latency). نرخ سفارش/handoff از جدول گفتگو.
  async compare(days: number) {
    const from = this.since(days);
    try {
      const perEngine = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        WITH conv AS (
          SELECT "conversationId" AS id, COALESCE(MAX(meta->>'engineMode'),'stable') AS engine,
                 SUM("costUsdMicros") AS cost, SUM("inputTokens") AS tin,
                 SUM("cachedInputTokens") AS cached, COUNT(DISTINCT "turnId") AS turns
          FROM ai_call_ledger
          WHERE "createdAt" >= ${from} AND "conversationId" IS NOT NULL
          GROUP BY 1)
        SELECT engine, COUNT(*) AS conversations,
               COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY cost),0) AS median_cost,
               COALESCE(percentile_cont(0.9) WITHIN GROUP (ORDER BY cost),0) AS p90_cost,
               COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY tin),0) AS median_tin,
               CASE WHEN SUM(tin)>0 THEN SUM(cached)::float/SUM(tin) ELSE 0 END AS cache_read_rate,
               COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY turns),0) AS median_turns
        FROM conv GROUP BY engine`);

      const latency = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT COALESCE(meta->>'engineMode','stable') AS engine,
               COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs"),0) AS p50,
               COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs"),0) AS p95
        FROM ai_call_ledger WHERE "createdAt" >= ${from} AND "callSite"='main_loop' GROUP BY 1`);

      // نرخ سفارش/handoff: از وضعیت گفتگو (مقدار enum واقعی را از schema می‌خوانیم؛ نبود → null)
      const outcomes = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        WITH eng AS (
          SELECT "conversationId" AS id, COALESCE(MAX(meta->>'engineMode'),'stable') AS engine
          FROM ai_call_ledger WHERE "createdAt" >= ${from} AND "conversationId" IS NOT NULL GROUP BY 1)
        SELECT eng.engine, COUNT(*) AS conversations,
               COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM orders o WHERE o."conversationId" = c.id)) AS with_order,
               COUNT(*) FILTER (WHERE c."currentState" = 'HANDOFF_HUMAN') AS handoff
        FROM eng JOIN sales_conversations c ON c.id = eng.id GROUP BY eng.engine`).catch(() => []);

      const by = (arr: Array<Record<string, unknown>>, e: string) => arr.find((r) => r.engine === e);
      const side = (e: 'stable' | 'lean') => {
        const p = by(perEngine, e);
        const l = by(latency, e);
        const o = by(outcomes, e);
        const n = num(p?.conversations);
        return {
          conversations: n,
          medianCostUsd: usd(p?.median_cost),
          p90CostUsd: usd(p?.p90_cost),
          medianInputTokens: num(p?.median_tin),
          cacheReadRate: num(p?.cache_read_rate),
          medianTurns: num(p?.median_turns),
          latencyP50Ms: Math.round(num(l?.p50)),
          latencyP95Ms: Math.round(num(l?.p95)),
          orderRate: o && num(o.conversations) ? num(o.with_order) / num(o.conversations) : null,
          handoffRate: o && num(o.conversations) ? num(o.handoff) / num(o.conversations) : null,
          enoughData: n >= 100,
        };
      };
      return { ready: true, days, stable: side('stable'), lean: side('lean') };
    } catch (err) {
      return { ready: false, error: (err as Error).message.slice(0, 200) };
    }
  }
}
