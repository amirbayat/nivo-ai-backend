import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, CreativeOutputType, CreativeSegment } from '@prisma/client'

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] })
const prisma = new PrismaClient({ adapter })

// چند سبک نمونه برای اینکه استودیوی محتوا بلافاصله بعد از docker compose up محتوا داشته باشد
// و قابل‌تست شود — ادمین از پنل (/admin/creative-prompts) می‌تواند این‌ها را ویرایش/حذف کند یا
// سبک‌های واقعی خودش را اضافه کند. مثل credit-packages.seed.ts، روی رکورد موجود (تشخیص با
// title) دست نمی‌زنیم. categoryName باید دقیقاً با نامی که creative-categories.seed.ts ساخته
// یکی باشد (این seed همیشه بعد از آن اجرا می‌شود — entrypoint.sh) تا لینک درست بخورد.
const PROMPTS: Array<{
  title: string
  outputType: CreativeOutputType
  segment: CreativeSegment
  categoryName: string
  description: string
  contextMd: string
  userPromptTemplate: string
  aspectRatio?: string
  exampleImageUrl?: string
  requiresUserImage: boolean
  creditCost: number
  isTrending: boolean
  isActive: boolean
  sortOrder: number
  tags: string[]
}> = [
  {
    title: 'کپشن اینستاگرام برای پست فروش',
    outputType: CreativeOutputType.TEXT,
    segment: CreativeSegment.INSTAGRAM,
    categoryName: 'اینستاگرام',
    description: 'یک کپشن جذاب و کوتاه برای معرفی محصول یا خدمات، با لحن صمیمی و call-to-action',
    contextMd: 'تو یک کپی‌رایتر حرفه‌ای فارسی‌زبان برای اینستاگرام هستی. کپشن کوتاه (حداکثر ۴-۵ خط)، با لحن صمیمی و طبیعی، همراه با یک call-to-action واضح بنویس. از ایموجی به‌اندازه (نه زیاد) استفاده کن.',
    userPromptTemplate: 'موضوع/محصول: {{input}}\n\nبر اساس این موضوع، یک کپشن اینستاگرام بنویس.',
    requiresUserImage: false,
    creditCost: 2,
    isTrending: true,
    isActive: true,
    sortOrder: 0,
    tags: ['کپشن', 'فروش', 'اینستاگرام'],
  },
  {
    title: 'کاور پست اینستاگرام — مینیمال',
    outputType: CreativeOutputType.IMAGE,
    segment: CreativeSegment.INSTAGRAM,
    categoryName: 'کاور پست اینستاگرام',
    description: 'یک کاور پست مربعی، تمیز و مینیمال برای فید اینستاگرام',
    contextMd: 'یک کاور پست اینستاگرام (مربعی) طراحی کن — مینیمال، رنگ‌بندی هماهنگ، تایپوگرافی خوانا، مناسب فید.',
    userPromptTemplate: '{{input}}',
    aspectRatio: '1024x1024',
    exampleImageUrl: 'https://placehold.co/1024x1024/1e293b/34d399?text=Preview',
    requiresUserImage: false,
    creditCost: 6,
    isTrending: true,
    isActive: true,
    sortOrder: 1,
    tags: ['کاور', 'پست', 'اینستاگرام'],
  },
  {
    title: 'پست اسلایدی آموزشی',
    outputType: CreativeOutputType.IMAGE,
    segment: CreativeSegment.INSTAGRAM,
    categoryName: 'پست اسلایدی اینستاگرام',
    description: 'اسلاید اول یک پست کاروسل آموزشی — عنوان بزرگ و جذاب',
    contextMd: 'اسلاید اول یک پست کاروسل (اسلایدی) آموزشی طراحی کن — عنوان بزرگ و واضح، پس‌زمینه‌ی ساده، حس حرفه‌ای.',
    userPromptTemplate: '{{input}}',
    aspectRatio: '1024x1024',
    exampleImageUrl: 'https://placehold.co/1024x1024/1e293b/34d399?text=Preview',
    requiresUserImage: false,
    creditCost: 6,
    isTrending: false,
    isActive: true,
    sortOrder: 2,
    tags: ['اسلاید', 'کاروسل', 'آموزشی'],
  },
  {
    title: 'کاور ریلز جذاب',
    outputType: CreativeOutputType.IMAGE,
    segment: CreativeSegment.INSTAGRAM,
    categoryName: 'کاور ریلز',
    description: 'کاور عمودی جذاب برای ریلز اینستاگرام',
    contextMd: 'یک کاور عمودی (۹:۱۶) برای ریلز اینستاگرام طراحی کن — پرانرژی، رنگ‌های جذاب، مناسب توقف اسکرول.',
    userPromptTemplate: '{{input}}',
    aspectRatio: '1024x1536',
    exampleImageUrl: 'https://placehold.co/1024x1536/1e293b/34d399?text=Preview',
    requiresUserImage: false,
    creditCost: 7,
    isTrending: true,
    isActive: true,
    sortOrder: 3,
    tags: ['ریلز', 'کاور', 'ویدیو'],
  },
  {
    title: 'استوری تبلیغاتی',
    outputType: CreativeOutputType.IMAGE,
    segment: CreativeSegment.INSTAGRAM,
    categoryName: 'استوری اینستاگرام',
    description: 'استوری عمودی برای معرفی تخفیف یا محصول جدید',
    contextMd: 'یک استوری عمودی (۹:۱۶) تبلیغاتی طراحی کن — جای خالی برای متن/لینک بالای استوری، رنگ‌بندی برند.',
    userPromptTemplate: '{{input}}',
    aspectRatio: '1024x1536',
    exampleImageUrl: 'https://placehold.co/1024x1536/1e293b/34d399?text=Preview',
    requiresUserImage: false,
    creditCost: 6,
    isTrending: false,
    isActive: true,
    sortOrder: 4,
    tags: ['استوری', 'تبلیغات'],
  },
  {
    title: 'تامبنیل یوتیوب پرکلیک',
    outputType: CreativeOutputType.IMAGE,
    segment: CreativeSegment.YOUTUBE,
    categoryName: 'تامبنیل یوتیوب',
    description: 'تامبنیل با کنتراست بالا و تایپوگرافی درشت برای افزایش نرخ کلیک',
    contextMd: 'یک تامبنیل یوتیوب طراحی کن — کنتراست بالا، عنصر بصری قوی، تایپوگرافی درشت و خوانا حتی در سایز کوچک.',
    userPromptTemplate: '{{input}}',
    aspectRatio: '1536x1024',
    exampleImageUrl: 'https://placehold.co/1536x1024/1e293b/34d399?text=Preview',
    requiresUserImage: false,
    creditCost: 7,
    isTrending: true,
    isActive: true,
    sortOrder: 5,
    tags: ['یوتیوب', 'تامبنیل'],
  },
  {
    title: 'ایده‌ی محتوا برای صفحه‌ی کسب‌وکار',
    outputType: CreativeOutputType.TEXT,
    segment: CreativeSegment.BUSINESS,
    categoryName: 'کسب‌وکار',
    description: '۵ ایده‌ی محتوایی متناسب با حوزه‌ی کاری‌ت برای هفته‌ی آینده',
    contextMd: 'تو یک استراتژیست محتوای شبکه‌های اجتماعی هستی. برای حوزه‌ی کاری داده‌شده، ۵ ایده‌ی محتوایی متنوع (آموزشی، پشت‌صحنه، معرفی محصول، تعاملی، داستان مشتری) به فارسی و کوتاه پیشنهاد بده — هرکدام یک خط.',
    userPromptTemplate: 'حوزه‌ی کاری: {{input}}\n\nبر اساس این حوزه، ۵ ایده‌ی محتوایی بده.',
    requiresUserImage: false,
    creditCost: 3,
    isTrending: false,
    isActive: true,
    sortOrder: 6,
    tags: ['ایده', 'محتوا', 'کسب‌وکار'],
  },
  {
    title: 'پوستر تبلیغاتی مینیمال',
    outputType: CreativeOutputType.IMAGE,
    segment: CreativeSegment.GENERAL,
    categoryName: 'پوستر تبلیغاتی',
    description: 'یک پوستر تبلیغاتی ساده و مینیمال بر اساس توضیح شما — بدون نیاز به آپلود عکس',
    contextMd: 'یک پوستر تبلیغاتی مینیمال، تمیز، با ترکیب‌بندی حرفه‌ای طراحی کن. رنگ‌بندی هماهنگ و فضای خالی کافی داشته باشد؛ سبک گرافیکی/فلت، نه عکاسی واقع‌گرایانه.',
    userPromptTemplate: '{{input}}',
    aspectRatio: '1024x1024',
    exampleImageUrl: 'https://placehold.co/1024x1024/1e293b/34d399?text=Preview',
    requiresUserImage: false,
    creditCost: 8,
    isTrending: true,
    isActive: true,
    sortOrder: 7,
    tags: ['پوستر', 'تبلیغات', 'مینیمال'],
  },
  {
    title: 'کارت ویزیت دیجیتال حرفه‌ای',
    outputType: CreativeOutputType.IMAGE,
    segment: CreativeSegment.BUSINESS,
    categoryName: 'کارت ویزیت دیجیتال',
    description: 'یک کارت ویزیت دیجیتال تمیز و حرفه‌ای بر اساس نام و حوزه‌ی کاری‌ت',
    contextMd: 'یک کارت ویزیت دیجیتال (نسبت ۹:۵ افقی) طراحی کن — چیدمان حرفه‌ای، تایپوگرافی خوانا برای نام/عنوان شغلی/شماره تماس، رنگ‌بندی کسب‌وکاری و مینیمال.',
    userPromptTemplate: 'نام و حوزه‌ی کاری: {{input}}',
    aspectRatio: '1536x1024',
    exampleImageUrl: 'https://placehold.co/1536x1024/1e293b/34d399?text=Preview',
    requiresUserImage: false,
    creditCost: 6,
    isTrending: false,
    isActive: true,
    sortOrder: 8,
    tags: ['کارت ویزیت', 'کسب‌وکار', 'برندینگ'],
  },
  {
    title: 'بنر تبلیغاتی وب‌سایت',
    outputType: CreativeOutputType.IMAGE,
    segment: CreativeSegment.BUSINESS,
    categoryName: 'بنر وب‌سایت',
    description: 'بنر عریض برای هدر سایت یا تبلیغات آنلاین',
    contextMd: 'یک بنر عریض تبلیغاتی برای وب‌سایت طراحی کن — ترکیب‌بندی افقی، جای خالی مناسب برای متن اصلی/دکمه‌ی CTA، رنگ‌بندی هماهنگ با هویت برند.',
    userPromptTemplate: '{{input}}',
    aspectRatio: '1536x1024',
    exampleImageUrl: 'https://placehold.co/1536x1024/1e293b/34d399?text=Preview',
    requiresUserImage: false,
    creditCost: 6,
    isTrending: false,
    isActive: true,
    sortOrder: 9,
    tags: ['بنر', 'وب‌سایت', 'تبلیغات'],
  },
  {
    title: 'تبدیل عکس محصول به پوستر حرفه‌ای',
    outputType: CreativeOutputType.IMAGE,
    segment: CreativeSegment.GENERAL,
    categoryName: 'پوستر تبلیغاتی',
    // requiresUserImage=true — اولین نمونه‌ی سیدشده که واقعاً از آپلود عکس کاربر استفاده می‌کند
    // (فیچر آپلود عکس دیسکاوری تازه اضافه شده؛ این سبک برای تست همون مسیر مناسبه)
    description: 'عکس محصولت رو آپلود کن تا یک پوستر تبلیغاتی حرفه‌ای دورش بسازیم',
    contextMd: 'با استفاده از عکس ورودی کاربر (محصول)، یک پوستر تبلیغاتی حرفه‌ای بساز — پس‌زمینه و ترکیب‌بندی مناسب دور محصول اضافه کن، بدون تغییر خود محصول در عکس.',
    userPromptTemplate: 'توضیح یا سبک دلخواه (اختیاری): {{input}}',
    aspectRatio: '1024x1024',
    exampleImageUrl: 'https://placehold.co/1024x1024/1e293b/34d399?text=Preview',
    requiresUserImage: true,
    creditCost: 9,
    isTrending: true,
    isActive: true,
    sortOrder: 10,
    tags: ['پوستر', 'محصول', 'آپلود عکس'],
  },
]

async function main() {
  for (const { categoryName, ...prompt } of PROMPTS) {
    const existing = await prisma.creativePrompt.findFirst({ where: { title: prompt.title } })
    if (existing) {
      // backfill غیرمخرب — فقط وقتی خود ادمین هنوز عکس نمونه‌ای برای این سبک ست نکرده
      // (exampleImageUrl خالی)، مقدار placeholder جدید seed را می‌گذاریم؛ بقیه‌ی فیلدها
      // (که ممکن است ادمین از پنل ویرایش کرده باشد) دست‌نخورده می‌مانند
      if (!existing.exampleImageUrl && prompt.exampleImageUrl) {
        await prisma.creativePrompt.update({
          where: { id: existing.id },
          data: { exampleImageUrl: prompt.exampleImageUrl },
        })
        console.log(`backfilled exampleImageUrl: ${prompt.title}`)
      } else {
        console.log(`skip (already exists): ${prompt.title}`)
      }
      continue
    }
    const category = await prisma.creativeCategory.findFirst({ where: { name: categoryName } })
    if (!category) {
      console.log(`  (⚠ category "${categoryName}" not found — creating "${prompt.title}" without a category)`)
    }
    await prisma.creativePrompt.create({ data: { ...prompt, categoryId: category?.id ?? null } })
    console.log(`created: ${prompt.title}`)
  }
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
