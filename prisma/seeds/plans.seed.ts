import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter })

const plans = [
  {
    name: 'رایگان',
    priceMonthly: 0,
    dailyFreeTokens: 5_000,
    monthlyTotalTokens: 0,
    allowedModels: ['openai/gpt-4o-mini'],
    features: {
      chatHistory: true,
      maxConversations: 10,
      support: 'community',
    },
    isActive: true,
    sortOrder: 0,
  },
  {
    name: 'نقره‌ای',
    priceMonthly: 1_500_000, // 150,000 Tomans in Rials
    dailyFreeTokens: 0,
    monthlyTotalTokens: 500_000,
    allowedModels: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
    features: {
      chatHistory: true,
      maxConversations: 100,
      support: 'email',
      fileUpload: false,
    },
    isActive: true,
    sortOrder: 1,
  },
  {
    name: 'طلایی',
    priceMonthly: 3_500_000, // 350,000 Tomans in Rials
    dailyFreeTokens: 0,
    monthlyTotalTokens: 2_000_000,
    allowedModels: ['openai/gpt-4o-mini', 'openai/gpt-4o', 'openai/gpt-4.1'],
    features: {
      chatHistory: true,
      maxConversations: -1, // unlimited
      support: 'priority',
      fileUpload: true,
      apiAccess: true,
    },
    isActive: true,
    sortOrder: 2,
  },
]

async function main() {
  console.log('Seeding plans...')

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { name: plan.name },
      update: {},   // never overwrite admin edits — only create if missing
      create: plan,
    })
    console.log(`  ✓ ${plan.name}`)
  }

  console.log('Done.')
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
