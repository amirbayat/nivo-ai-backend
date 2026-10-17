import { z } from 'zod';
import { BRIEF_TOPICS } from './topics';

// بند ۱۶.۳ — خروجی LLM (قبل از اعتبارسنجی قطعی)
export const briefLlmSchema = z.object({
  sectionTopics: z.array(z.object({ id: z.string(), topics: z.array(z.enum(BRIEF_TOPICS)).max(3) })),
  facts: z.array(z.object({ k: z.string(), v: z.string(), sure: z.boolean(), src: z.string() })).max(16),
  caveats: z.array(z.object({ quote: z.string(), src: z.string() })).max(8),
  sellerRules: z.array(z.object({ quote: z.string(), src: z.string() })).max(8),
  pitch: z.object({
    benefits: z.array(z.string()).max(6),
    benefitSources: z.array(z.string()).max(6),
    valueLines: z.array(z.string()).max(3),
    followUps: z.array(z.string()).max(4),
    openers: z.array(z.string()).max(4),
  }),
  textPriceStock: z.object({ prices: z.array(z.string()).max(6), stockMentions: z.array(z.string()).max(6) }),
});
export type BriefLlmOutput = z.infer<typeof briefLlmSchema>;

export interface BriefFact { k: string; v: string; sure: boolean; src: string }
export interface BriefQuote { quote: string; src: string }
export interface ValidatedBrief {
  facts: BriefFact[];
  caveats: BriefQuote[];
  sellerRules: BriefQuote[];
  // null = پیچ ناقص (کمتر از ۲ benefit معتبر)
  pitch: { benefits: string[]; benefitSources: string[]; valueLines: string[]; followUps: string[]; openers: string[] } | null;
  textPriceStock: { prices: string[]; stockMentions: string[] };
}
