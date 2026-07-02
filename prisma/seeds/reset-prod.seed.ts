/**
 * reset-prod.seed.ts
 *
 * Resets the production database to a clean initial state:
 *   - Deletes ALL user data (conversations, messages, payments, etc.)
 *   - Upserts the three default plans with correct pricing
 *   - Creates/updates the Vexa super-admin account
 *
 * Run via:
 *   ./scripts/db-reset.sh
 */

import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter })

// ─── ادمین اصلی ───────────────────────────────────────────────
const ADMIN_PHONE = '09032334441'

// ─── پلن‌ها ───────────────────────────────────────────────────
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
    maxInputTokens: 300,
    outputThrottleSteps: [],
    dailyMessageLimit: 20,
    isActive: true,
    sortOrder: 0,
  },
  {
    name: 'نقره‌ای',
    priceMonthly: 1_500_000,
    dailyFreeTokens: 0,
    monthlyTotalTokens: 500_000,
    allowedModels: ['openai/gpt-4o-mini', 'openai/gpt-4o'],
    features: {
      chatHistory: true,
      maxConversations: 100,
      support: 'email',
      fileUpload: false,
    },
    maxInputTokens: 1_500,
    outputThrottleSteps: [],
    dailyMessageLimit: null,
    isActive: true,
    sortOrder: 1,
  },
  {
    name: 'طلایی',
    priceMonthly: 3_500_000,
    dailyFreeTokens: 0,
    monthlyTotalTokens: 2_000_000,
    allowedModels: ['openai/gpt-4o-mini', 'openai/gpt-4o', 'openai/gpt-4.1'],
    features: {
      chatHistory: true,
      maxConversations: -1,
      support: 'priority',
      fileUpload: true,
      apiAccess: true,
    },
    maxInputTokens: 6_000,
    outputThrottleSteps: [],
    dailyMessageLimit: null,
    isActive: true,
    sortOrder: 2,
  },
]

async function main() {
  console.log('\n🔄 Vexa Production Database Reset\n')

  // ─── پاک‌سازی داده‌های کاربران ──────────────────────────────
  console.log('🗑  Clearing user data...')
  await prisma.$transaction([
    prisma.ticketReply.deleteMany(),
    prisma.supportTicket.deleteMany(),
    prisma.walletTransaction.deleteMany(),
    prisma.wallet.deleteMany(),
    prisma.userQuotaOverride.deleteMany(),
    prisma.feedbackSummary.deleteMany(),
    prisma.feedback.deleteMany(),
    prisma.dailyUsage.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.message.deleteMany(),
    prisma.conversation.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.subscription.deleteMany(),
    prisma.user.deleteMany(),
  ])
  console.log('  ✓ All user data deleted')

  // ─── پلن‌ها ──────────────────────────────────────────────────
  console.log('\n📋 Seeding plans...')
  for (const plan of plans) {
    const { name, outputThrottleSteps, ...rest } = plan
    await prisma.plan.upsert({
      where: { name },
      update: { ...rest, outputThrottleSteps: JSON.stringify(outputThrottleSteps) },
      create: { name, ...rest, outputThrottleSteps: JSON.stringify(outputThrottleSteps) },
    })
    console.log(`  ✓ ${name}`)
  }

  // ─── ادمین اصلی ──────────────────────────────────────────────
  console.log('\n👤 Creating super-admin...')

  const goldenPlan = await prisma.plan.findUnique({ where: { name: 'طلایی' } })
  if (!goldenPlan) throw new Error('طلایی plan not found after seeding!')

  const admin = await prisma.user.upsert({
    where: { phone: ADMIN_PHONE },
    update: { role: 'ADMIN', isActive: true },
    create: {
      phone: ADMIN_PHONE,
      name: 'ادمین وکسا',
      role: 'ADMIN',
      isActive: true,
    },
  })
  console.log(`  ✓ Admin user: ${admin.phone} (id: ${admin.id})`)

  // اشتراک طلایی بدون تاریخ انقضا (۱۰۰ سال)
  const periodStart = new Date()
  const periodEnd = new Date()
  periodEnd.setFullYear(periodEnd.getFullYear() + 100)

  await prisma.subscription.upsert({
    where: { userId: admin.id },
    update: {
      planId: goldenPlan.id,
      status: 'ACTIVE',
      periodStart,
      periodEnd,
    },
    create: {
      userId: admin.id,
      planId: goldenPlan.id,
      status: 'ACTIVE',
      periodStart,
      periodEnd,
    },
  })
  console.log(`  ✓ Admin subscription: طلایی (active for 100 years)`)

  // کیف پول ادمین
  await prisma.wallet.upsert({
    where: { userId: admin.id },
    update: {},
    create: { userId: admin.id, balanceRial: 0 },
  })
  console.log(`  ✓ Admin wallet created`)

  // ─── خلاصه ───────────────────────────────────────────────────
  const planCount = await prisma.plan.count()
  const userCount = await prisma.user.count()

  console.log('\n✅ Reset complete!')
  console.log(`   Plans:  ${planCount}`)
  console.log(`   Users:  ${userCount} (admin only)`)
  console.log(`\n   Admin phone: ${ADMIN_PHONE}`)
  console.log('   Login via OTP at https://admin.vexaai.ir\n')
}

main()
  .catch(e => {
    console.error('\n❌ Reset failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
