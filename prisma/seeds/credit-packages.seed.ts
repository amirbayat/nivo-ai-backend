import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter })

// سه بسته‌ی ثابت + یک کارت «مبلغ دلخواه» برای بالاتر از سقف بسته‌های ثابت (بخش درخواست کاربر
// ۱۴۰۵-۰۵-۲۵) — قیمت واقعی در لحظه‌ی نمایش/خرید محاسبه می‌شود (CreditsService.computePackagePrice)،
// این فقط تعداد نیوو + تخفیف/برچسب هر بسته را ثابت می‌کند. از ادمین (CreditConfigPage) هم قابل‌تغییرند.
const PACKAGES = [
  { credits: 400, discountPercent: 0, isPopular: false, isBestValue: false, isCustomAmount: false, sortOrder: 0 },
  { credits: 800, discountPercent: 5, isPopular: true, isBestValue: false, isCustomAmount: false, sortOrder: 1 },
  { credits: 1200, discountPercent: 10, isPopular: false, isBestValue: true, isCustomAmount: false, sortOrder: 2 },
  // کارت بزرگ عدد دلخواه — credits=1500 یعنی حداقل مجاز؛ کاربر عدد واقعی‌اش را در لحظه‌ی خرید وارد می‌کند
  { credits: 1500, discountPercent: 10, isPopular: false, isBestValue: false, isCustomAmount: true, sortOrder: 3 },
]

async function main() {
  for (const pkg of PACKAGES) {
    const existing = await prisma.creditPackage.findFirst({
      where: { credits: pkg.credits, isCustomAmount: pkg.isCustomAmount },
    })
    if (existing) {
      // مثل models.seed.ts — روی رکورد موجود دست نمی‌زنیم تا تغییرات دستی ادمین از بین نرود
      console.log(`skip (already exists): credits=${pkg.credits} isCustomAmount=${pkg.isCustomAmount}`)
      continue
    }
    await prisma.creditPackage.create({ data: pkg })
    console.log(`created: credits=${pkg.credits} isCustomAmount=${pkg.isCustomAmount}`)
  }
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
