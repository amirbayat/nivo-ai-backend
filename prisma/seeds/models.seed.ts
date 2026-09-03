import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter })

// این لیست دقیقاً منطبق با کاتالوگ فعلی پروداکشن است (۱۴۰۵-۰۴-۱۸) — تا محیط dev/local هم‌سنگ prod بماند
const MODELS = [
  { name: 'openai/gpt-4o-mini', displayName: 'GPT-4o mini', provider: 'openai', inputPricePerM: 0.15, outputPricePerM: 0.6, supportsVision: true, sortOrder: 1, tier: 'SIMPLE' as const, tokenizerFamily: 'o200k_base', avgCharsPerToken: 4 },
  { name: 'openai/gpt-4.1-mini', displayName: 'GPT-4.1 Mini', provider: 'openai', inputPricePerM: 0.4, outputPricePerM: 1.6, supportsVision: true, sortOrder: 2, tier: 'SIMPLE' as const, tokenizerFamily: 'o200k_base', avgCharsPerToken: 4 },
  { name: 'openai/gpt-5-nano', displayName: 'GPT-5 Nano', provider: 'openai', inputPricePerM: 0.05, outputPricePerM: 0.4, supportsVision: true, sortOrder: 3, tier: 'SIMPLE' as const, tokenizerFamily: 'o200k_base', avgCharsPerToken: 4 },
  { name: 'openai/gpt-5-mini', displayName: 'GPT-5 Mini', provider: 'openai', inputPricePerM: 0.25, outputPricePerM: 2, supportsVision: true, sortOrder: 4, tier: 'SIMPLE' as const, tokenizerFamily: 'o200k_base', avgCharsPerToken: 4 },
  { name: 'openai/gpt-5.4-nano', displayName: 'GPT-5.4 Nano', provider: 'openai', inputPricePerM: 0.2, outputPricePerM: 1.25, supportsVision: true, sortOrder: 5, tier: 'SIMPLE' as const, tokenizerFamily: 'o200k_base', avgCharsPerToken: 4 },
  { name: 'openai/gpt-5.4-mini', displayName: 'GPT-5.4 Mini', provider: 'openai', inputPricePerM: 0.75, outputPricePerM: 4.5, supportsVision: true, sortOrder: 6, tier: 'MEDIUM' as const, tokenizerFamily: 'o200k_base', avgCharsPerToken: 4 },
  { name: 'openai/gpt-5.1-codex-mini', displayName: 'GPT-5.1-Codex-Mini', provider: 'openai', inputPricePerM: 0.25, outputPricePerM: 2, supportsVision: true, sortOrder: 7, tier: 'MEDIUM' as const, tokenizerFamily: 'o200k_base', avgCharsPerToken: 4 },
  { name: 'openai/o3-mini', displayName: 'o3 Mini', provider: 'openai', inputPricePerM: 1.1, outputPricePerM: 4.4, supportsVision: false, sortOrder: 8, tier: 'MEDIUM' as const, tokenizerFamily: 'o200k_base', avgCharsPerToken: 4 },
  { name: 'openai/o4-mini', displayName: 'o4 Mini', provider: 'openai', inputPricePerM: 1.1, outputPricePerM: 4.4, supportsVision: true, sortOrder: 9, tier: 'MEDIUM' as const, tokenizerFamily: 'o200k_base', avgCharsPerToken: 4 },
  { name: 'openai/o4-mini-high', displayName: 'o4 Mini High', provider: 'openai', inputPricePerM: 1.1, outputPricePerM: 4.4, supportsVision: true, sortOrder: 10, tier: 'COMPLEX' as const, tokenizerFamily: 'o200k_base', avgCharsPerToken: 4 },
  { name: 'google/gemma-3-27b-it', displayName: 'Gemma 3 27B', provider: 'google', inputPricePerM: 0.08, outputPricePerM: 0.16, supportsVision: true, sortOrder: 11, tier: 'SIMPLE' as const, tokenizerFamily: 'approximate', avgCharsPerToken: 4 },
  { name: 'google/gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash Lite', provider: 'google', inputPricePerM: 0.1, outputPricePerM: 0.4, supportsVision: true, sortOrder: 12, tier: 'SIMPLE' as const, tokenizerFamily: 'approximate', avgCharsPerToken: 4 },
  { name: 'google/gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash Lite', provider: 'google', inputPricePerM: 0.25, outputPricePerM: 1.5, supportsVision: true, sortOrder: 13, tier: 'SIMPLE' as const, tokenizerFamily: 'approximate', avgCharsPerToken: 4 },
  { name: 'google/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', provider: 'google', inputPricePerM: 0.3, outputPricePerM: 2.5, supportsVision: true, sortOrder: 14, tier: 'MEDIUM' as const, tokenizerFamily: 'approximate', avgCharsPerToken: 4 },
  { name: 'google/gemini-3-flash-preview', displayName: 'Gemini 3 Flash Preview', provider: 'google', inputPricePerM: 0.5, outputPricePerM: 3, supportsVision: true, sortOrder: 15, tier: 'MEDIUM' as const, tokenizerFamily: 'approximate', avgCharsPerToken: 4 },
  { name: 'x-ai/grok-build-0.1', displayName: 'Grok Build 0.1', provider: 'x-ai', inputPricePerM: 1, outputPricePerM: 2, supportsVision: true, sortOrder: 16, tier: 'MEDIUM' as const, tokenizerFamily: 'approximate', avgCharsPerToken: 4 },
  { name: 'x-ai/grok-4.20', displayName: 'Grok 4.20', provider: 'x-ai', inputPricePerM: 1.25, outputPricePerM: 2.5, supportsVision: true, sortOrder: 17, tier: 'MEDIUM' as const, tokenizerFamily: 'approximate', avgCharsPerToken: 4 },
  { name: 'x-ai/grok-4.3', displayName: 'Grok 4.3', provider: 'x-ai', inputPricePerM: 1.25, outputPricePerM: 2.5, supportsVision: true, sortOrder: 18, tier: 'MEDIUM' as const, tokenizerFamily: 'approximate', avgCharsPerToken: 4 },
  { name: 'x-ai/grok-4.20-multi-agent', displayName: 'Grok 4.20 Multi-Agent', provider: 'x-ai', inputPricePerM: 1.25, outputPricePerM: 2.5, supportsVision: true, sortOrder: 19, tier: 'COMPLEX' as const, tokenizerFamily: 'approximate', avgCharsPerToken: 4 },
  { name: 'deepseek/deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', provider: 'deepseek', inputPricePerM: 0.09, outputPricePerM: 0.18, supportsVision: false, sortOrder: 20, tier: 'SIMPLE' as const, tokenizerFamily: 'approximate', avgCharsPerToken: 4 },
  { name: 'deepseek/deepseek-chat-v3.1', displayName: 'DeepSeek V3.1', provider: 'deepseek', inputPricePerM: 0.21, outputPricePerM: 0.79, supportsVision: false, sortOrder: 21, tier: 'MEDIUM' as const, tokenizerFamily: 'approximate', avgCharsPerToken: 4 },
  { name: 'deepseek/deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', provider: 'deepseek', inputPricePerM: 0.43, outputPricePerM: 0.87, supportsVision: false, sortOrder: 22, tier: 'MEDIUM' as const, tokenizerFamily: 'approximate', avgCharsPerToken: 4 },
  { name: 'deepseek/deepseek-r1-distill-llama-70b', displayName: 'R1 Distill Llama 70B', provider: 'deepseek', inputPricePerM: 0.8, outputPricePerM: 0.8, supportsVision: false, sortOrder: 23, tier: 'MEDIUM' as const, tokenizerFamily: 'approximate', avgCharsPerToken: 4 },
  // sortOrder: 0 یعنی این مدل دیفالت تولید عکس استودیو است (discovery-generation.service.ts resolveModel —
  // پایین‌ترین sortOrder بین IMAGE_GEN های فعال، وقتی سبک preferredModel ندارد و کاربر هم مدلی انتخاب نکرده)
  { name: 'openai/gpt-image-2', displayName: 'GPT Image 2', provider: 'openai', modelType: 'IMAGE_GEN' as const, inputPricePerM: 0, outputPricePerM: 0, supportsVision: false, supportsImageGen: true, platform: ['OPENROUTER' as const], sortOrder: 0, tier: 'MEDIUM' as const, tokenizerFamily: 'approximate', avgCharsPerToken: 4 },
  // این چهار مدل + gpt-image-2 بالا، ۵ مدل تولید عکس چت‌محور هستند — tier تعیین می‌کند
  // classifyImagePrompt/rankImageModelCandidates (chat.service.ts) کدام را برای چه سطحی از
  // پیچیدگی درخواست انتخاب کند: SIMPLE=سریع/ارزان، MEDIUM=معمولی، COMPLEX=فوتورئالیستیک/جزئیات‌دار.
  // قیمت واقعی (imageGenFlatPriceUsd/Unit یا per-token) عمداً اینجا صفر است — باید از پنل ادمین
  // با نرخ واقعی OpenRouter پر شود (docs/PRD-image-gen-pricing-and-credit-fix.md)
  { name: 'google/gemini-3.1-flash-lite-image', displayName: 'Gemini 3.1 Flash Lite Image', provider: 'google', modelType: 'IMAGE_GEN' as const, inputPricePerM: 0, outputPricePerM: 0, supportsVision: false, supportsImageGen: true, platform: ['OPENROUTER' as const], sortOrder: 24, tier: 'SIMPLE' as const, tokenizerFamily: 'approximate', avgCharsPerToken: 4 },
  { name: 'google/gemini-2.5-flash-image', displayName: 'Gemini 2.5 Flash Image', provider: 'google', modelType: 'IMAGE_GEN' as const, inputPricePerM: 0, outputPricePerM: 0, supportsVision: false, supportsImageGen: true, platform: ['OPENROUTER' as const], sortOrder: 25, tier: 'MEDIUM' as const, tokenizerFamily: 'approximate', avgCharsPerToken: 4 },
  { name: 'openai/gpt-5-image-mini', displayName: 'GPT-5 Image Mini', provider: 'openai', modelType: 'IMAGE_GEN' as const, inputPricePerM: 0, outputPricePerM: 0, supportsVision: false, supportsImageGen: true, platform: ['OPENROUTER' as const], sortOrder: 26, tier: 'MEDIUM' as const, tokenizerFamily: 'approximate', avgCharsPerToken: 4 },
  { name: 'openai/gpt-5.4-image-2', displayName: 'GPT-5.4 Image 2', provider: 'openai', modelType: 'IMAGE_GEN' as const, inputPricePerM: 0, outputPricePerM: 0, supportsVision: false, supportsImageGen: true, platform: ['OPENROUTER' as const], sortOrder: 27, tier: 'COMPLEX' as const, tokenizerFamily: 'approximate', avgCharsPerToken: 4 },
]

async function main() {
  for (const model of MODELS) {
    await prisma.aiModel.upsert({
      where: { name: model.name },
      create: model,
      update: {},   // admin changes survive restarts
    })
    console.log(`✓ model: ${model.displayName}`)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
