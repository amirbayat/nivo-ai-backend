import { Injectable } from '@nestjs/common'
import { countTokens as countTokensO200k } from 'gpt-tokenizer/encoding/o200k_base'
import { countTokens as countTokensCl100k } from 'gpt-tokenizer/encoding/cl100k_base'
import { AiModelRegistryService } from './ai-model-registry.service'

type Counter = (input: string) => number

const EXACT_COUNTERS: Record<string, Counter> = {
  o200k_base: countTokensO200k, // gpt-4o, gpt-4o-mini, gpt-4.1, ...
  cl100k_base: countTokensCl100k, // gpt-4, gpt-4-turbo, gpt-3.5-turbo, ...
}

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
 */
@Injectable()
export class TokenEstimatorService {
  constructor(private readonly modelRegistry: AiModelRegistryService) {}

  async estimateTokens(text: string, modelId: string): Promise<number> {
    if (!text) return 0

    const { tokenizerFamily, avgCharsPerToken } =
      await this.modelRegistry.getModelInfo(modelId)

    const exact = EXACT_COUNTERS[tokenizerFamily]
    if (exact) return exact(text)

    const ratio = avgCharsPerToken > 0 ? avgCharsPerToken : 4
    return Math.ceil(text.length / ratio)
  }
}
