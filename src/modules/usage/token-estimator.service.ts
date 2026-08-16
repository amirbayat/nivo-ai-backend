import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { join } from 'node:path';
import Piscina from 'piscina';
import { AiModelRegistryService } from './ai-model-registry.service';
import type { TokenEstimateTask } from './token-estimator.worker';

/**
 * Replaces the old `Math.ceil(text.length / 3)` guess (docs/PRD-global-budget-gateway.md بخش ۹).
 *
 * OpenAI-family models get an exact BPE count via gpt-tokenizer. Other
 * providers (Claude, Grok, DeepSeek, ...) don't ship an offline tokenizer,
 * so they fall back to a chars-per-token ratio read from AiModel — set once
 * per model in the admin panel (AiModelRegistryService), no code change
 * needed when a new provider is added. The ~4 chars/token default is the
 * commonly cited average for English/Latin text; Persian-heavy models
 * should be recalibrated lower once real usage data is available (compare
 * against the SDK's actual `usage.inputTokens`/`usage.outputTokens`).
 *
 * gpt-tokenizer's actual counting is synchronous/CPU-bound — running it on
 * the main thread blocks Node's single event loop for every concurrent
 * user, not just the caller (docs/PERFORMANCE-AND-CONCURRENCY.md بخش ۲).
 * So the counting itself runs on a small worker-thread pool (Piscina);
 * this service only does the (async, Redis/DB-backed) model lookup on the
 * main thread and hands the actual text off to a worker.
 */
@Injectable()
export class TokenEstimatorService implements OnModuleDestroy {
  private readonly logger = new Logger(TokenEstimatorService.name);

  // maxThreads کوچک عمداً — این CPU-bound است، نه I/O-bound؛ تعداد thread بیشتر از
  // core های واقعی موجود روی container فقط context-switch اضافه می‌کنه، سرعت نمی‌ده
  private readonly pool = new Piscina<TokenEstimateTask, number>({
    filename: join(__dirname, 'token-estimator.worker.js'),
    minThreads: 1,
    maxThreads: 2,
  });

  constructor(private readonly modelRegistry: AiModelRegistryService) {}

  async estimateTokens(text: string, modelId: string): Promise<number> {
    if (!text) return 0;

    const { tokenizerFamily, avgCharsPerToken } =
      await this.modelRegistry.getModelInfo(modelId);

    return this.pool.run({ text, tokenizerFamily, avgCharsPerToken });
  }

  async onModuleDestroy() {
    await this.pool
      .destroy()
      .catch((err) =>
        this.logger.error('token estimator pool destroy failed', err),
      );
  }
}
