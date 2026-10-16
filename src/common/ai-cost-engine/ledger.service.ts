import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerEntry, setLedgerSink } from './ledger-sink';

const FLUSH_INTERVAL_MS = 2000;
const FLUSH_BATCH = 200;
const MAX_BUFFER = 5000;
const RETENTION_DAYS = 90;

// ACE-0 — نوشتن بافرشده‌ی ledger. fail-safe: خطای DB (مثلاً SQL اجرا نشده) فقط یک‌بار warning می‌دهد.
@Injectable()
export class LedgerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LedgerService.name);
  private buffer: LedgerEntry[] = [];
  private timer?: NodeJS.Timeout;
  private warned = false;
  private lastPurge = 0;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    setLedgerSink((e) => this.push(e));
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    setLedgerSink(null);
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  push(entry: LedgerEntry): void {
    if (this.buffer.length >= MAX_BUFFER) this.buffer.shift();
    this.buffer.push(entry);
    if (this.buffer.length >= FLUSH_BATCH) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, FLUSH_BATCH * 5);
    try {
      await this.prisma.aiCallLedger.createMany({
        data: batch.map((e) => ({
          storeId: e.storeId ?? null,
          conversationId: e.conversationId ?? null,
          turnId: e.turnId ?? null,
          callSite: e.callSite,
          servedBy: e.servedBy,
          model: e.model ?? null,
          inputTokens: e.inputTokens ?? 0,
          cachedInputTokens: e.cachedInputTokens ?? 0,
          cacheWriteTokens: e.cacheWriteTokens ?? 0,
          outputTokens: e.outputTokens ?? 0,
          reasoningTokens: e.reasoningTokens ?? 0,
          steps: e.steps ?? 0,
          costUsdMicros: e.costUsdMicros ?? 0,
          costIsEstimate: e.costIsEstimate ?? false,
          avoidedUsdMicros: e.avoidedUsdMicros ?? 0,
          latencyMs: e.latencyMs ?? 0,
          meta: (e.meta ?? undefined) as never,
        })),
      });
      void this.purgeOld();
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(`ai ledger write failed (SQL اجرا شده؟): ${(err as Error).message}`);
      }
    }
  }

  // نگه‌داری ۹۰ روزه؛ حداکثر روزی یک‌بار
  private async purgeOld(): Promise<void> {
    if (Date.now() - this.lastPurge < 24 * 3600 * 1000) return;
    this.lastPurge = Date.now();
    try {
      await this.prisma.aiCallLedger.deleteMany({
        where: { createdAt: { lt: new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000) } },
      });
    } catch {
      /* best-effort */
    }
  }
}
