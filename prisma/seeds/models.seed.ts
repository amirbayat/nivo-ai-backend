import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter })

const MODELS = [
  {
    name: 'openai/gpt-4o-mini',
    displayName: 'GPT-4o mini',
    provider: 'openai',
    inputPricePerM: 0.15,
    outputPricePerM: 0.60,
    supportsVision: true,
    sortOrder: 0,
    tier: 'SIMPLE' as const,
  },
  {
    name: 'openai/gpt-4o',
    displayName: 'GPT-4o',
    provider: 'openai',
    inputPricePerM: 2.50,
    outputPricePerM: 10.00,
    supportsVision: true,
    sortOrder: 1,
    tier: 'MEDIUM' as const,
  },
  {
    name: 'openai/gpt-4-turbo',
    displayName: 'GPT-4 Turbo',
    provider: 'openai',
    inputPricePerM: 10.00,
    outputPricePerM: 30.00,
    supportsVision: true,
    sortOrder: 2,
    tier: 'COMPLEX' as const,
  },
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
