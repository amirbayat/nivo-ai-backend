import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter })

// پله‌های پیش‌فرض قیمت‌گذاری زیرنویس (docs/PRD-video-auto-captions.md §۱۴.۳) — کالیبره‌شده
// روی بدترین‌حالت هزینه‌ی واقعی (fallback به گران‌ترین مدل ASR، whisper-1)، نه هزینه‌ی معمول
// (که چون Whisper فوق‌العاده ارزان است، قیمت‌گذاری هزینه‌محور ارزش واقعی فیچر را منعکس نمی‌کند).
// از پنل ادمین («CaptionPricingPage») کاملاً CRUD می‌شود — این‌ها فقط seed اولیه‌اند.
const DEFAULT_TIERS = [
  { maxDurationSec: 20, creditCost: 2, sortOrder: 1 },
  { maxDurationSec: 40, creditCost: 3, sortOrder: 2 },
  { maxDurationSec: 60, creditCost: 4, sortOrder: 3 },
  { maxDurationSec: 120, creditCost: 6, sortOrder: 4 },
  { maxDurationSec: 300, creditCost: 9, sortOrder: 5 },
  { maxDurationSec: 600, creditCost: 14, sortOrder: 6 },
  { maxDurationSec: null, creditCost: 20, sortOrder: 7 }, // تا ۲۰ دقیقه (سقف محصول) — ردیف باز
]

async function main() {
  const existing = await prisma.captionPricingTier.count()
  if (existing > 0) {
    console.log(`skip (already has ${existing} tier(s))`)
    return
  }
  for (const tier of DEFAULT_TIERS) {
    await prisma.captionPricingTier.create({ data: tier })
    console.log(`created: maxDurationSec=${tier.maxDurationSec ?? '∞'} creditCost=${tier.creditCost}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
