import { countTokens as countTokensO200k } from 'gpt-tokenizer/encoding/o200k_base';
import { countTokens as countTokensCl100k } from 'gpt-tokenizer/encoding/cl100k_base';

type Counter = (input: string) => number;

const EXACT_COUNTERS: Record<string, Counter> = {
  o200k_base: countTokensO200k,
  cl100k_base: countTokensCl100k,
};

export interface TokenEstimateTask {
  text: string;
  tokenizerFamily: string;
  avgCharsPerToken: number;
}

// این فایل روی یک worker thread جدا اجرا می‌شود (از TokenEstimatorService، از طریق
// Piscina) — چون gpt-tokenizer کاملاً synchronous/CPU-bound است و اگر روی همون event loop
// اصلی اجرا بشه، کل Node (از جمله ارسال chunk های SSE کاربرهای دیگه) رو معطل نگه می‌داره.
// این فایل عمداً بدون هیچ وابستگی به NestJS/Redis/Prisma است — worker thread جدا شریک هیچ
// state ای با پردازش اصلی نیست، فقط یک متن می‌گیرد و یک عدد برمی‌گرداند.
export default function estimateTokensWorker({
  text,
  tokenizerFamily,
  avgCharsPerToken,
}: TokenEstimateTask): number {
  const exact = EXACT_COUNTERS[tokenizerFamily];
  if (exact) return exact(text);

  const ratio = avgCharsPerToken > 0 ? avgCharsPerToken : 4;
  return Math.ceil(text.length / ratio);
}
