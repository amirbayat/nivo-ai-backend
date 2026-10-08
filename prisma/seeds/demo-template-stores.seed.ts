import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Client as MinioClient } from 'minio';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { generateShortCode } from '../../src/common/utils/generate-code';
import type { ProductVideoItem } from '../../src/modules/store/product-video.types';

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter });

// همون کانفیگ StorageService (src/storage/storage.service.ts) — این اسکریپت مستقل از Nest DI
// اجرا می‌شود (docker compose exec ... ts-node)، پس یک کلاینت MinIO جدا ولی هم‌تنظیمات می‌سازد
const minioBucket = process.env['MINIO_BUCKET'] ?? 'chat-images';
const minio = new MinioClient({
  endPoint: process.env['MINIO_ENDPOINT'] ?? 'localhost',
  port: Number(process.env['MINIO_PORT'] ?? '9000'),
  useSSL: (process.env['MINIO_USE_SSL'] ?? 'false') === 'true',
  accessKey: process.env['MINIO_ACCESS_KEY'] ?? 'minioadmin',
  secretKey: process.env['MINIO_SECRET_KEY'] ?? 'minioadmin',
});

// عکس‌های آماده‌شده از استوک آزاد (Pixabay) — docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md
// بخش ۲۰؛ یک عکس به ازای هر محصول، به ترتیب همون آرایه‌ی products بالا، در
// prisma/seeds/demo-assets/<slug>/<شماره‌ی ۱-پایه>.jpg — اگر فایلی برای یک محصول نبود،
// آن محصول بدون عکس ساخته می‌شود (مسدودکننده نیست)
async function uploadTemplateProductImage(
  slug: string,
  productIndex: number,
): Promise<string | undefined> {
  const filePath = path.join(
    __dirname,
    'demo-assets',
    slug,
    `${productIndex + 1}.jpg`,
  );
  if (!fs.existsSync(filePath)) return undefined;
  const buffer = fs.readFileSync(filePath);
  const key = `${crypto.randomUUID()}.jpg`;
  await minio.putObject(minioBucket, key, buffer);
  return key;
}

// فیلم‌های کوتاه (هم از Pixabay، زیر ۸۵ ثانیه — سقف واقعی بک‌اند ۹۰ ثانیه است، حاشیه‌ی امن).
// مدت دقیق فایل را اسکریپت دانلود همون لحظه از پاسخ Pixabay گرفته و کنار فایل در یک
// sidecar متنی (<n>.video-duration.txt) نوشته — اینجا دوباره نیازی به probe کردن ویدیو نیست
async function uploadTemplateProductVideo(
  slug: string,
  productIndex: number,
): Promise<ProductVideoItem | undefined> {
  const videoPath = path.join(
    __dirname,
    'demo-assets',
    slug,
    `${productIndex + 1}.mp4`,
  );
  const durationPath = path.join(
    __dirname,
    'demo-assets',
    slug,
    `${productIndex + 1}.video-duration.txt`,
  );
  if (!fs.existsSync(videoPath) || !fs.existsSync(durationPath))
    return undefined;
  const buffer = fs.readFileSync(videoPath);
  const durationSec = Number(fs.readFileSync(durationPath, 'utf8').trim());
  const key = `${crypto.randomUUID()}.mp4`;
  await minio.putObject(minioBucket, key, buffer);
  return { key, durationSec };
}

async function generateUniqueReferralCode(): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const code = generateShortCode();
    const clash = await prisma.user.findUnique({
      where: { referralCode: code },
    });
    if (!clash) return code;
    if (attempt > 5) throw new Error('failed to generate unique referral code');
  }
}

// docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۵.۱، ۱۸ فاز ۲ — این شماره
// هیچ‌وقت واقعی نیست و isActive=false است، یعنی هیچ‌کس هیچ‌وقت نمی‌تواند با OTP واردش شود؛
// فقط sellerId صوری برای ۱۳ فروشگاه «قالب» (isDemoTemplate=true) که هیچ‌وقت مستقیم نمایش
// داده نمی‌شوند، فقط منبع کپی‌اند (demo.service.ts's ensureDemoStore)
const TEMPLATE_OWNER_PHONE = '00000000001';

// فرمت معتبر کارت (۱۶ رقم) ولی واقعی نیست — فروشگاه‌های قالب/کپی‌شده هیچ‌وقت Order واقعی
// نمی‌سازند (leadCaptureOnly=true روی کپی‌ها در demo.service.ts)، پس این کارت هیچ‌وقت
// برای پرداخت واقعی نمایش داده نمی‌شود
const PLACEHOLDER_CARD = '6037991000000000';
const PLACEHOLDER_OWNER_NAME = 'فروشگاه نمونه نیوو';

interface TemplateProduct {
  name: string;
  basePrice: number;
  stock: number;
  description: string;
}

interface TemplateStore {
  slug: string;
  category: string;
  name: string;
  brandIntro: string;
  products: TemplateProduct[];
}

// docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۸ فاز ۲، §۱۹.۵ — ۱۶ دسته‌ی
// کالا/دیجیتال (demo-categories.ts)؛ ۴ دسته‌ی خدماتی/نوبت‌دهی + «سایر» عمداً خارج از این seed هستند
const TEMPLATES: TemplateStore[] = [
  {
    slug: 'demo-template-clothing',
    category: 'پوشاک',
    name: 'فروشگاه نمونه پوشاک',
    brandIntro:
      'فروشگاه نمونه‌ی پوشاک — لباس روزمره و اسپرت با کیفیت مناسب قیمت.',
    products: [
      {
        name: 'تیشرت نخی مردانه',
        basePrice: 320000,
        stock: 40,
        description: 'تیشرت آستین‌کوتاه نخ پنبه، سایزبندی M تا XL',
      },
      {
        name: 'پیراهن زنانه گلدار',
        basePrice: 580000,
        stock: 25,
        description: 'پیراهن نخی طرح گلدار، مناسب فصل بهار و تابستان',
      },
      {
        name: 'شلوار جین مردانه',
        basePrice: 740000,
        stock: 30,
        description: 'شلوار جین اسلیم‌فیت، رنگ آبی تیره',
      },
      {
        name: 'هودی اسپرت یونیسکس',
        basePrice: 650000,
        stock: 35,
        description: 'هودی کلاه‌دار، پارچه فرنچ‌تری ضخیم',
      },
    ],
  },
  {
    slug: 'demo-template-bags-shoes',
    category: 'کیف و کفش',
    name: 'فروشگاه نمونه کیف و کفش',
    brandIntro: 'فروشگاه نمونه‌ی کیف و کفش — تولیدی و وارداتی، گارانتی اصالت.',
    products: [
      {
        name: 'کیف دستی زنانه چرم مصنوعی',
        basePrice: 890000,
        stock: 20,
        description: 'کیف دستی با دسته بلند قابل تنظیم',
      },
      {
        name: 'کفش اسپرت مردانه',
        basePrice: 1250000,
        stock: 18,
        description: 'کفش رانینگ سبک، کفی طبی',
      },
      {
        name: 'کتونی زنانه سفید',
        basePrice: 980000,
        stock: 22,
        description: 'کتونی کلاسیک سفید، مناسب استفاده روزمره',
      },
      {
        name: 'کوله‌پشتی دانشجویی',
        basePrice: 540000,
        stock: 28,
        description: 'کوله‌پشتی ضدآب با جای لپ‌تاپ',
      },
    ],
  },
  {
    slug: 'demo-template-cosmetics',
    category: 'آرایشی و بهداشتی',
    name: 'فروشگاه نمونه آرایشی و بهداشتی',
    brandIntro:
      'فروشگاه نمونه‌ی لوازم آرایشی و بهداشتی — محصولات اورجینال با کد رهگیری.',
    products: [
      {
        name: 'کرم مرطوب‌کننده صورت',
        basePrice: 420000,
        stock: 50,
        description: 'کرم آبرسان مناسب پوست خشک و معمولی',
      },
      {
        name: 'رژ لب مات',
        basePrice: 185000,
        stock: 60,
        description: 'رژ لب ماندگار با ۸ رنگ متنوع',
      },
      {
        name: 'شامپو تقویت مو',
        basePrice: 260000,
        stock: 45,
        description: 'شامپو ضدریزش با عصاره‌ی گیاهی',
      },
      {
        name: 'ضدآفتاب SPF50',
        basePrice: 395000,
        stock: 40,
        description: 'ضدآفتاب بدون چربی، مناسب زیر آرایش',
      },
    ],
  },
  {
    slug: 'demo-template-home-kitchen',
    category: 'خانه و آشپزخانه',
    name: 'فروشگاه نمونه خانه و آشپزخانه',
    brandIntro:
      'فروشگاه نمونه‌ی لوازم خانه و آشپزخانه — کیفیت انتخابی برای زندگی روزمره.',
    products: [
      {
        name: 'سرویس قابلمه ۱۲ پارچه',
        basePrice: 4200000,
        stock: 10,
        description: 'سرویس قابلمه استیل با پوشش سرامیک',
      },
      {
        name: 'اتو بخار',
        basePrice: 1450000,
        stock: 15,
        description: 'اتوی بخار قدرتمند با مخزن آب بزرگ',
      },
      {
        name: 'چای‌ساز برقی',
        basePrice: 980000,
        stock: 20,
        description: 'چای‌ساز دوقوری با دمای قابل‌تنظیم',
      },
      {
        name: 'سرویس چاقو آشپزخانه ۶ پارچه',
        basePrice: 650000,
        stock: 25,
        description: 'ست چاقوی استیل ضدزنگ با پایه چوبی',
      },
    ],
  },
  {
    slug: 'demo-template-digital',
    category: 'دیجیتال و لوازم جانبی',
    name: 'فروشگاه نمونه دیجیتال',
    brandIntro:
      'فروشگاه نمونه‌ی دیجیتال و لوازم جانبی موبایل — اورجینال و گارانتی‌دار.',
    products: [
      {
        name: 'هندزفری بلوتوث',
        basePrice: 890000,
        stock: 30,
        description: 'هندزفری بی‌سیم با نویزکنسلینگ فعال',
      },
      {
        name: 'پاوربانک ۲۰۰۰۰ میلی‌آمپر',
        basePrice: 650000,
        stock: 35,
        description: 'پاوربانک فست‌شارژ با دو پورت خروجی',
      },
      {
        name: 'قاب گوشی ضدضربه',
        basePrice: 185000,
        stock: 50,
        description: 'قاب سیلیکونی ضدضربه، چند مدل گوشی',
      },
      {
        name: 'کابل شارژ تایپ-سی',
        basePrice: 145000,
        stock: 60,
        description: 'کابل بافته‌شده فست‌شارژ، طول ۱.۵ متر',
      },
    ],
  },
  {
    slug: 'demo-template-food',
    category: 'خوراکی و صنایع غذایی',
    name: 'فروشگاه نمونه خوراکی',
    brandIntro:
      'فروشگاه نمونه‌ی خوراکی و صنایع غذایی — محصولات ارگانیک و خانگی.',
    products: [
      {
        name: 'عسل طبیعی چهل‌گیاه',
        basePrice: 450000,
        stock: 25,
        description: 'عسل خام بدون شکر، بسته‌بندی یک‌کیلویی',
      },
      {
        name: 'آجیل مخلوط برشته',
        basePrice: 680000,
        stock: 20,
        description: 'میکس آجیل خام، بسته ۵۰۰ گرمی',
      },
      {
        name: 'زعفران سرگل',
        basePrice: 920000,
        stock: 15,
        description: 'زعفران درجه یک، بسته ۵ گرمی',
      },
      {
        name: 'چای ایرانی ممتاز',
        basePrice: 210000,
        stock: 40,
        description: 'چای لاهیجان، بسته ۴۵۰ گرمی',
      },
    ],
  },
  {
    slug: 'demo-template-kids-baby',
    category: 'کودک و نوزاد',
    name: 'فروشگاه نمونه کودک و نوزاد',
    brandIntro:
      'فروشگاه نمونه‌ی کودک و نوزاد — لوازم ایمن و باکیفیت برای کوچولوها.',
    products: [
      {
        name: 'پوشک بچه سایز ۳',
        basePrice: 390000,
        stock: 30,
        description: 'بسته ۴۴ عددی، فوق‌جاذب',
      },
      {
        name: 'شیشه شیر ضدنفخ',
        basePrice: 220000,
        stock: 35,
        description: 'شیشه شیر ۲۵۰ میلی‌لیتری با سر شیشه سیلیکونی',
      },
      {
        name: 'لباس نوزادی نخی',
        basePrice: 280000,
        stock: 25,
        description: 'ست سه‌تکه نخی مناسب نوزاد تا ۶ ماه',
      },
      {
        name: 'عروسک آموزشی',
        basePrice: 340000,
        stock: 20,
        description: 'عروسک نرم با صداهای آموزشی',
      },
    ],
  },
  {
    slug: 'demo-template-sports-travel',
    category: 'ورزش و سفر',
    name: 'فروشگاه نمونه ورزش و سفر',
    brandIntro:
      'فروشگاه نمونه‌ی ورزش و سفر — تجهیزات کوهنوردی و سفرهای خانوادگی.',
    products: [
      {
        name: 'کوله‌پشتی کوهنوردی ۵۰ لیتری',
        basePrice: 1650000,
        stock: 15,
        description: 'کوله حرفه‌ای با پوشش ضدآب',
      },
      {
        name: 'چادر مسافرتی دو نفره',
        basePrice: 2100000,
        stock: 10,
        description: 'چادر سبک ضدآب، نصب سریع',
      },
      {
        name: 'کفش کوهنوردی',
        basePrice: 1850000,
        stock: 12,
        description: 'کفش ضدآب با کفی ضدلغزش',
      },
      {
        name: 'بطری آب ورزشی',
        basePrice: 165000,
        stock: 40,
        description: 'بطری عایق‌دار ۷۵۰ میلی‌لیتری',
      },
    ],
  },
  {
    slug: 'demo-template-jewelry',
    category: 'جواهرات و اکسسوری',
    name: 'فروشگاه نمونه جواهرات',
    brandIntro: 'فروشگاه نمونه‌ی جواهرات و اکسسوری — طراحی مدرن، قیمت منصفانه.',
    products: [
      {
        name: 'گردنبند نقره',
        basePrice: 780000,
        stock: 20,
        description: 'گردنبند نقره استرلینگ با پلاک مینیمال',
      },
      {
        name: 'دستبند استیل مردانه',
        basePrice: 390000,
        stock: 25,
        description: 'دستبند استیل ضدحساسیت و ضدزنگ',
      },
      {
        name: 'انگشتر نگین‌دار زنانه',
        basePrice: 560000,
        stock: 18,
        description: 'انگشتر روکش طلا با نگین زیرکونیا',
      },
      {
        name: 'گوشواره مروارید',
        basePrice: 420000,
        stock: 22,
        description: 'گوشواره آویز با مروارید مصنوعی',
      },
    ],
  },
  {
    slug: 'demo-template-books-stationery',
    category: 'کتاب و لوازم‌التحریر',
    name: 'فروشگاه نمونه کتاب و لوازم‌التحریر',
    brandIntro:
      'فروشگاه نمونه‌ی کتاب و لوازم‌التحریر — برای دانش‌آموزان و دانشجویان.',
    products: [
      {
        name: 'دفتر یادداشت ۱۰۰ برگ',
        basePrice: 95000,
        stock: 60,
        description: 'دفتر جلدسخت خط‌دار، صحافی فنری',
      },
      {
        name: 'خودکار ژله‌ای رنگی (۱۲ رنگ)',
        basePrice: 145000,
        stock: 50,
        description: 'پک ۱۲ عددی خودکار ژله‌ای رنگارنگ',
      },
      {
        name: 'کتاب رمان ایرانی',
        basePrice: 220000,
        stock: 30,
        description: 'رمان پرفروش نویسندگان معاصر ایرانی',
      },
      {
        name: 'پک مداد رنگی ۲۴ عددی',
        basePrice: 185000,
        stock: 35,
        description: 'مداد رنگی روغنی با جعبه فلزی',
      },
    ],
  },
  {
    slug: 'demo-template-flowers-plants',
    category: 'گل و گیاه',
    name: 'فروشگاه نمونه گل و گیاه',
    brandIntro: 'فروشگاه نمونه‌ی گل و گیاه — گیاهان آپارتمانی و دسته‌گل تازه.',
    products: [
      {
        name: 'گلدان ساکولنت',
        basePrice: 185000,
        stock: 25,
        description: 'ساکولنت در گلدان سرامیکی کوچک',
      },
      {
        name: 'دسته گل رز هلندی',
        basePrice: 650000,
        stock: 15,
        description: 'دسته ۲۰ شاخه رز هلندی تازه',
      },
      {
        name: 'بذر گل آفتابگردان',
        basePrice: 45000,
        stock: 50,
        description: 'بسته بذر آفتابگردان زینتی',
      },
      {
        name: 'گیاه آپارتمانی پوتوس',
        basePrice: 290000,
        stock: 20,
        description: 'گیاه پوتوس در گلدان پلاستیکی، مناسب فضای داخلی',
      },
    ],
  },
  {
    slug: 'demo-template-handicrafts',
    category: 'صنایع‌دستی',
    name: 'فروشگاه نمونه صنایع‌دستی',
    brandIntro: 'فروشگاه نمونه‌ی صنایع‌دستی — تولیدات دست‌ساز هنرمندان ایرانی.',
    products: [
      {
        name: 'تابلو فرش دستباف کوچک',
        basePrice: 1450000,
        stock: 8,
        description: 'تابلو فرش دستباف طرح سنتی',
      },
      {
        name: 'سفال نقاشی‌شده',
        basePrice: 380000,
        stock: 15,
        description: 'گلدان سفالی با نقاشی دست‌ساز',
      },
      {
        name: 'رودوشی بافتنی دست‌ساز',
        basePrice: 420000,
        stock: 18,
        description: 'شال بافتنی پشمی، بافت دست',
      },
      {
        name: 'جعبه چوبی منبت‌کاری',
        basePrice: 560000,
        stock: 12,
        description: 'جعبه جواهرات چوبی با طرح منبت',
      },
    ],
  },
  {
    slug: 'demo-template-pets',
    category: 'حیوانات خانگی',
    name: 'فروشگاه نمونه حیوانات خانگی',
    brandIntro:
      'فروشگاه نمونه‌ی لوازم حیوانات خانگی — غذا و اکسسوری سگ و گربه.',
    products: [
      {
        name: 'غذای خشک گربه',
        basePrice: 580000,
        stock: 25,
        description: 'غذای خشک بالغ، بسته ۲ کیلوگرمی',
      },
      {
        name: 'قلاده سگ',
        basePrice: 220000,
        stock: 30,
        description: 'قلاده قابل‌تنظیم با بند بلند',
      },
      {
        name: 'شن بهداشتی گربه',
        basePrice: 195000,
        stock: 35,
        description: 'شن بنتونیتی خوشبو، بسته ۵ کیلویی',
      },
      {
        name: 'اسباب‌بازی جویدنی سگ',
        basePrice: 165000,
        stock: 40,
        description: 'اسباب‌بازی لاستیکی ضدحساسیت',
      },
    ],
  },
  {
    slug: 'demo-template-online-courses',
    category: 'دوره آموزشی و محصولات دیجیتال',
    name: 'فروشگاه نمونه دوره‌های آموزشی',
    brandIntro:
      'فروشگاه نمونه‌ی دوره‌های آموزشی آنلاین — ویدیو و فایل قابل‌دانلود، تحویل بعد از تایید سفارش.',
    products: [
      {
        name: 'دوره‌ی جامع مربی‌گری آنلاین',
        basePrice: 1450000,
        stock: 999,
        description: 'بیش از ۲۰ ساعت ویدیوی آموزشی + فایل تمرین، دسترسی دائمی',
      },
      {
        name: 'پکیج مقدماتی عکاسی با موبایل',
        basePrice: 390000,
        stock: 999,
        description: 'آموزش گام‌به‌گام ۸ جلسه‌ای به‌صورت ویدیو',
      },
      {
        name: 'قالب آماده صفحه فرود (لندینگ)',
        basePrice: 190000,
        stock: 999,
        description: 'فایل Figma + HTML آماده، قابل‌شخصی‌سازی',
      },
      {
        name: 'کتاب الکترونیک آموزش فروش دایرکت',
        basePrice: 120000,
        stock: 999,
        description: 'فایل PDF، ۸۰ صفحه، ارسال فوری بعد از خرید',
      },
    ],
  },
  {
    slug: 'demo-template-carpets-antiques',
    category: 'فرش دستباف و عتیقه',
    name: 'فروشگاه نمونه فرش و عتیقه',
    brandIntro:
      'فروشگاه نمونه‌ی فرش دستباف و اشیای عتیقه — قیمت نهایی بعد از مذاکره در چت.',
    products: [
      {
        name: 'فرش دستباف قشقایی (۶ متری)',
        basePrice: 18500000,
        stock: 3,
        description: 'فرش دستباف اصیل، طرح سنتی، قابل‌معاینه حضوری',
      },
      {
        name: 'گلیم دستباف کردستان',
        basePrice: 4200000,
        stock: 6,
        description: 'گلیم دورو، نخ و رنگ طبیعی',
      },
      {
        name: 'ساعت دیواری عتیقه برنجی',
        basePrice: 2850000,
        stock: 2,
        description: 'ساعت دیواری قدیمی، کارکرده و اصل، سالم و سرویس‌شده',
      },
      {
        name: 'سماور زغالی آنتیک',
        basePrice: 3600000,
        stock: 4,
        description: 'سماور قدیمی برنجی، قابل‌استفاده و تزئینی',
      },
    ],
  },
  {
    slug: 'demo-template-repair-services',
    category: 'خدمات تعمیر',
    name: 'فروشگاه نمونه خدمات تعمیر',
    brandIntro:
      'فروشگاه نمونه‌ی تعمیرات موبایل و لوازم خانگی — هزینه‌ی بازدید اولیه، ادامه‌ی قیمت در چت.',
    products: [
      {
        name: 'هزینه بازدید و عیب‌یابی موبایل',
        basePrice: 150000,
        stock: 999,
        description:
          'بازدید حضوری/اکسپرس + تشخیص ایراد، قابل‌کسر از هزینه‌ی تعمیر',
      },
      {
        name: 'تعویض باتری گوشی (قطعه اورجینال)',
        basePrice: 650000,
        stock: 999,
        description: 'شامل باتری + نصب، گارانتی ۳ ماهه',
      },
      {
        name: 'تعمیر صفحه نمایش گوشی',
        basePrice: 1200000,
        stock: 999,
        description: 'قیمت پایه برای مدل‌های پرتقاضا، نهایی بعد از دیدن دستگاه',
      },
      {
        name: 'سرویس و تعمیر لباسشویی',
        basePrice: 400000,
        stock: 999,
        description: 'هزینه اعزام تکنسین + بازدید، قطعه جدا محاسبه می‌شود',
      },
    ],
  },
];

async function main() {
  const existingOwner = await prisma.user.findUnique({
    where: { phone: TEMPLATE_OWNER_PHONE },
  });
  const owner =
    existingOwner ??
    (await prisma.user.create({
      data: {
        phone: TEMPLATE_OWNER_PHONE,
        role: 'USER',
        isActive: false,
        name: 'مالک فروشگاه‌های قالب دمو (سیستمی)',
        referralCode: await generateUniqueReferralCode(),
      },
    }));

  for (const tpl of TEMPLATES) {
    const existing = await prisma.store.findUnique({
      where: { slug: tpl.slug },
    });
    if (existing) {
      console.log(`skip (already exists): ${tpl.slug}`);
      continue;
    }

    // آپلود عکس‌ها قبل از هر نوشتن روی DB انجام می‌شود (نه بعد از store.create) — وگرنه یک
    // خطای گذرا در MinIO وسط حلقه، فروشگاهی با صفر محصول باقی می‌گذارد که چک «skip (already
    // exists)» بالا دیگر هیچ‌وقت کامل نمی‌کندش (این دقیقاً هنگام تست همین تغییر رخ داد — پیش
    // از این فیکس). علاوه بر این، store.create و product.createMany داخل یک تراکنش هستند تا
    // اگر createMany به هر دلیلی شکست بخورد، store هم rollback شود، نه اینکه یتیم بماند
    const imageKeys: (string | undefined)[] = [];
    const videoItems: (ProductVideoItem | undefined)[] = [];
    for (let i = 0; i < tpl.products.length; i++) {
      imageKeys.push(await uploadTemplateProductImage(tpl.slug, i));
      videoItems.push(await uploadTemplateProductVideo(tpl.slug, i));
    }

    await prisma.$transaction(async (tx) => {
      const store = await tx.store.create({
        data: {
          sellerId: owner.id,
          slug: tpl.slug,
          name: tpl.name,
          category: tpl.category,
          bankCardNumber: PLACEHOLDER_CARD,
          bankOwnerName: PLACEHOLDER_OWNER_NAME,
          brandIntro: tpl.brandIntro,
          isDemoTemplate: true,
        },
      });

      await tx.product.createMany({
        data: tpl.products.map((p, i) => {
          const imageKey = imageKeys[i];
          const videoItem = videoItems[i];
          return {
            storeId: store.id,
            name: p.name,
            basePrice: p.basePrice,
            stock: p.stock,
            description: p.description,
            images: imageKey ? [imageKey] : [],
            videos: videoItem ? [videoItem] : [],
          };
        }),
      });
    });

    console.log(`created: ${tpl.slug} (+${tpl.products.length} products)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
