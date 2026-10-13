// پکیج‌های AI SDK فقط ESM هستند و jest (CJS) نمی‌تواند لودشان کند. تست‌های واحد هیچ‌وقت به LLM
// واقعی نمی‌زنند؛ اگر تستی به رفتار واقعی نیاز داشت، همان تست jest.mock مخصوص خودش را می‌گذارد.
const fn = () => undefined;
export const generateObject = fn;
export const generateText = fn;
export const streamText = fn;
export const tool = (t: unknown) => t;
export const createOpenAICompatible = () => fn;
export const createOpenAI = () => fn;
export const gateway = fn;
