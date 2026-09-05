import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, PricingGenerationType } from '@prisma/client'

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter })

// یک پله‌ی باز (بدون سقف) برای هرکدام — جایگزین ضریب ثابت قبلی Plan.payAsYouGoMarkup (۱.۳).
// از ادمین (صفحه‌ی «پله‌های ضریب قیمت») می‌توان این‌ها را ویرایش کرد یا پله‌های بیشتر
// (با minToman/maxToman باریک‌تر) اضافه کرد.
const DEFAULT_TIERS = [
  { type: PricingGenerationType.TEXT, minToman: 0, maxToman: null, markup: 1.5 },
  { type: PricingGenerationType.IMAGE, minToman: 0, maxToman: null, markup: 1.2 },
  { type: PricingGenerationType.VIDEO, minToman: 0, maxToman: null, markup: 1.1 },
]

async function main() {
  for (const tier of DEFAULT_TIERS) {
    const existing = await prisma.pricingTier.findFirst({ where: { type: tier.type } })
    if (existing) {
      console.log(`skip (already has tiers): type=${tier.type}`)
      continue
    }
    await prisma.pricingTier.create({ data: tier })
    console.log(`created: type=${tier.type} markup=${tier.markup}`)
  }
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
