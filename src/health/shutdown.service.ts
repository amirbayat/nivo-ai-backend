import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { markShuttingDown } from '../common/shutdown-state';
import {
  getActiveLlmTurns,
  waitForLlmTurnsToDrain,
} from '../common/services/llm-turn-guard';

export const SHUTDOWN_DRAIN_TIMEOUT_MS = 30_000;

// R1.3 — ترتیب Nest: beforeApplicationShutdown ← بستن HTTP ← onApplicationShutdown (صف‌های Bull
// با queue.close() منتظر jobهای فعال می‌مانند). اینجا قبل از بستن HTTP، turnهای چت را تخلیه می‌کنیم.
@Injectable()
export class ShutdownService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(ShutdownService.name);

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    markShuttingDown();
    const active = getActiveLlmTurns();
    this.logger.log(`shutdown (${signal ?? 'unknown'}): ${active} turn(s) in flight`);
    const drained = await waitForLlmTurnsToDrain(SHUTDOWN_DRAIN_TIMEOUT_MS);
    if (!drained) {
      this.logger.warn(
        `shutdown drain timed out with ${getActiveLlmTurns()} turn(s) still running`,
      );
    }
  }
}
