import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter })

// درخت اولیه‌ی دسته‌بندی دیسکاوری — ادمین از /admin/creative-categories می‌تونه اضافه/ویرایش/حذف کنه.
// مثل seedهای دیگه (credit-packages، creative-prompts)، روی رکورد موجود (تشخیص با name+parent) دست نمی‌زنیم.
const TREE: { name: string; sortOrder: number; children?: { name: string; sortOrder: number }[] }[] = [
  {
    name: 'اینستاگرام',
    sortOrder: 0,
    children: [
      { name: 'کاور پست اینستاگرام', sortOrder: 0 },
      { name: 'پست اسلایدی اینستاگرام', sortOrder: 1 },
      { name: 'کاور ریلز', sortOrder: 2 },
      { name: 'استوری اینستاگرام', sortOrder: 3 },
    ],
  },
  {
    name: 'یوتیوب',
    sortOrder: 1,
    children: [
      { name: 'تامبنیل یوتیوب', sortOrder: 0 },
      { name: 'کاور کانال یوتیوب', sortOrder: 1 },
    ],
  },
  {
    name: 'کسب‌وکار',
    sortOrder: 2,
    children: [
      { name: 'پوستر تبلیغاتی', sortOrder: 0 },
      { name: 'کارت ویزیت دیجیتال', sortOrder: 1 },
      { name: 'بنر وب‌سایت', sortOrder: 2 },
    ],
  },
  {
    name: 'عمومی',
    sortOrder: 3,
  },
]

async function main() {
  for (const root of TREE) {
    let parent = await prisma.creativeCategory.findFirst({ where: { name: root.name, parentId: null } })
    if (!parent) {
      parent = await prisma.creativeCategory.create({ data: { name: root.name, sortOrder: root.sortOrder } })
      console.log(`created root: ${root.name}`)
    } else {
      console.log(`skip (already exists): ${root.name}`)
    }

    for (const child of root.children ?? []) {
      const existing = await prisma.creativeCategory.findFirst({ where: { name: child.name, parentId: parent.id } })
      if (existing) {
        console.log(`  skip (already exists): ${root.name} › ${child.name}`)
        continue
      }
      await prisma.creativeCategory.create({
        data: { name: child.name, parentId: parent.id, sortOrder: child.sortOrder },
      })
      console.log(`  created: ${root.name} › ${child.name}`)
    }
  }
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
