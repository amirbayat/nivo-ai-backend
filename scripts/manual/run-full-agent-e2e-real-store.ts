// docs/PRD-sales-agent-tool-calling-architecture.md — تست end-to-end واقعی (API واقعی
// OpenRouter، بدون DB) معماری جدید FULL_AGENT. منطق runFullAgentTurn/callFullAgentTurn
// (conversation-engine.service.ts) این‌جا عیناً روی داده‌ی درون‌حافظه‌ای بازسازی شده (همون
// الگوی run-implicit-need-e2e-real-store.ts) چون متدهای private کلاس‌اند و بدون بوت کامل
// Nest/DB قابل فراخوانی مستقیم نیستند — هر تغییر در آن متدها باید دستی این‌جا هم اعمال شود.
//
// سناریوی اصلی («conv1») دقیقاً همان مکالمه‌ی واقعی‌ای است که کاربر زنده تست کرد و باگ ریشه‌ای
// را پیدا کرد (فروشگاه «نهایت یادگیری» — همون محصولات واقعی run-implicit-need-e2e-real-store.ts):
//   «سلام محصولاتتون رو نشون بدید» → «میخوام برنامه نویس فرانت اند بشم» (قبلاً OFF_TOPIC_OR_SPAM
//   می‌گرفت) → «این دوره ها به چه دردی میخورن؟» → «خب با کدوم میتونم سریعتر کار پیدا کنم؟» →
//   «من اگر بخوام فرانت بشم چی؟» (باگ ریشه‌ای — بدون تاریخچه، parseIntent این را گم می‌کرد).
//
// سناریوی دوم («conv2») فقط برای تست مکانیزم نادج (بخش ۴): ۴ پیام پشت‌سرهم کاملاً اطلاعاتی
// بدون هیچ نشانه‌ی تصمیم خرید — انتظار: از نوبت ۴ (openQuestionStreak>=3 در ابتدای نوبت) نادج
// فعال شود.
//
// اجرا: npx ts-node --transpile-only scripts/manual/run-full-agent-e2e-real-store.ts [variantKey]
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(__dirname, '../../../.env') });
loadEnv({ path: resolve(__dirname, '../../.env.localtest'), override: false });

import type { ConfigService } from '@nestjs/config';
import { generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { AiProviderService } from '../../src/common/services/ai-provider.service';
import {
  resolveModel,
  DEFAULT_VARIANT_KEY,
} from '../../src/modules/sales-agent/model-variants';
import { toneForCategory } from '../../src/modules/sales-agent/tone-by-category';

const fakeConfig = {
  get: (key: string) => process.env[key],
} as unknown as ConfigService;

const OPEN_QUESTION_NUDGE_THRESHOLD = 3;
const OPEN_QUESTION_NUDGE_INSTRUCTION = `مشتری چند پیام پشت‌سرهم فقط سوال اطلاعاتی پرسیده بدون
نزدیک‌شدن به تصمیم خرید. این‌بار جواب را با معرفی دقیقاً یک محصول مشخص (مرتبط‌ترین با کل بحث تا
الان) و یک دعوت صریح به اضافه‌کردن به سبد تمام کن — حتی اگر مشتری دوباره فقط سوال پرسیده. هرگز نگو
سوالاتت تموم شده یا از جواب‌دادن امتناع نکن؛ فقط مکالمه را به‌سمت یک تصمیم مشخص هدایت کن.`;

// docs/PRD-sales-agent-persuasion-principles.md — عیناً کپی PERSUASION_INSTRUCTION
// (conversation-engine.service.ts)
const PERSUASION_INSTRUCTION = `اگر جلوی یک محصول در واقعیت‌ها نشانه‌ی «[متقاعدسازی: مجاز]» آمده،
می‌توانی طبیعی و کوتاه (نه فشار فروش) از تکنیک‌های متقاعدسازی اخلاقی زیر استفاده کنی — همیشه فقط با
سیگنال‌های واقعی که همان‌جا آمده، هرگز با عدد/ادعای ساختگی؛ برای محصولاتی که این نشانه را ندارند
اصلاً از این تکنیک‌ها استفاده نکن، فقط واقعیت خام را بگو:
۱. تعهد و ثبات: قبل از پیشنهاد، هدف خودِ مشتری را در یک جمله‌ی کوتاه echo کن، بعد پیشنهادت را
   دقیقاً به همان هدف وصل کن.
۲. اثبات اجتماعی: اگر نظر خریدار واقعی زیر محصول آمده، طبیعی به آن اشاره کن — اگر هم‌زمان خودِ
   محصول یک چیز عمومی/شناخته‌شده هم هست (طبق بند دانش عمومی پایین)، وقتی مشتری صریح نظر/رضایت
   می‌پرسد می‌توانی این دو را در یک جمله‌ی کوتاه ترکیب کنی: اول یک اشاره‌ی خیلی کوتاه به جایگاه/
   محبوبیت عمومی آن موضوع در دنیا، بلافاصله بعدش نظر واقعی خریدارهای همین فروشگاه — نه این‌که
   یکی را به‌جای دیگری بگویی.
۳. اقتدار: اگر «تعداد سفارش واقعی» زیر محصول آمده، می‌توانی به آن اشاره کنی.
۴. علاقه: لحن گرم و همدلانه داشته باش (طبق لحن بالا).
۵. تقابل: همیشه اول یک جواب واقعاً کامل و مفید بده، بعد پیشنهاد بده.
۶. کمیابی: فقط اگر «موجودی محدود» (هرگز عدد دقیق) یا یک کد تخفیف واقعی با مهلت نزدیک زیر آمده،
   به آن اشاره کن — هرگز فوریت ساختگی نساز.
علاوه‌بر این شش‌تا: اگر خودِ محصول یک چیز عمومی و واقعاً شناخته‌شده در دنیاست (مثلاً یک فریم‌ورک/
تکنولوژی/برند معروف، نه یک محصول اختصاصی این فروشگاه)، فقط در همین حالت اجازه داری یک جمله‌ی کوتاه
از دانش عمومی خودت درباره‌ی خودِ آن موضوع (نه درباره‌ی این دوره/محصول مشخص فروشگاه) اضافه کنی —
مثلاً میزان محبوبیت/تقاضای بازار کار. اگر مطمئن نیستی این موضوع واقعاً به‌اندازه‌ی کافی شناخته‌شده
است، این کار را نکن. هیچ‌وقت بیشتر از یکی-دوتا از این تکنیک‌ها را هم‌زمان در یک پاسخ فشار نده.
در respond_to_customer، هرکدام از ۶ اصل بالا را که واقعاً در همین متن استفاده کردی در
persuasionTechniquesUsed بگذار (برای ثبت/گزارش داخلی فروشنده، نه چیزی که مشتری ببیند) و اگر از
دانش عمومی خودت (بند بالا) استفاده کردی usedGeneralKnowledge را true کن — اگر هیچ‌کدام را استفاده
نکردی، این‌ها را خالی/false بگذار، صادقانه.`;

const AUTHORITY_MIN_ORDER_COUNT = 5;

// داده‌ی شبیه‌سازی‌شده‌ی سیگنال‌های واقعی (معادل commentsFactsSuffix/countApprovedOrdersForProduct
// واقعی که در این اسکریپت بدون DB در دسترس نیستند) — فقط برای سناریوی ۴/۵ پایین استفاده می‌شود
const PERSUASION_DATA: Record<
  string,
  { comments: string[]; approvedOrderCount: number }
> = {
  '54a65651-8c73-4978-8406-4454222ee0c1': {
    comments: [
      'خیلی روان توضیح داده بود، سریع شروع کردم',
      'برای شروع فرانت‌اند عالی بود',
    ],
    approvedOrderCount: 42,
  },
  'c9527ce2-97cd-425f-abff-f0c20e5176aa': {
    comments: [],
    approvedOrderCount: 1,
  },
};

type PersuasionConfig = {
  enabled: boolean;
  // شناسه‌ی محصولی که برای این تست موجودی‌اش کم شبیه‌سازی می‌شود (استاک واقعی PRODUCTS دست‌نخورده می‌ماند)
  lowStockProductId?: string;
  urgentDiscount?: { code: string; hoursLeftText: string };
  disabledProductIds?: string[];
};

function buildPersuasionNote(
  product: Product,
  persuasion?: PersuasionConfig,
): string {
  if (!persuasion?.enabled) return '';
  if (persuasion.disabledProductIds?.includes(product.id)) return '';
  const data = PERSUASION_DATA[product.id] ?? {
    comments: [],
    approvedOrderCount: 0,
  };
  const signals: string[] = [];
  if (data.comments.length) {
    signals.push(
      `نظر خریدارهای قبلی: ${data.comments.map((c) => `«${c}»`).join('، ')}`,
    );
  }
  if (data.approvedOrderCount >= AUTHORITY_MIN_ORDER_COUNT) {
    signals.push(
      `تاکنون ${data.approvedOrderCount} سفارش واقعی تاییدشده برای این محصول ثبت شده`,
    );
  }
  const effectiveLowStock = persuasion.lowStockProductId === product.id;
  if (effectiveLowStock) {
    signals.push(
      'موجودی این محصول محدود است (فقط عبارت کلی بگو، هرگز عدد دقیق)',
    );
  }
  const signalsText = signals.length
    ? ` — سیگنال‌های واقعی: ${signals.join('؛ ')}`
    : '';
  return ` [متقاعدسازی: مجاز]${signalsText}`;
}

const STORE = {
  category: 'سایر',
  brandIntro: null as string | null,
  shippingInfo: null as string | null,
  returnPolicy: null as string | null,
};

// همون محصولات واقعی run-implicit-need-e2e-real-store.ts (فروشگاه پایلوت «نهایت یادگیری»)
const PRODUCTS = [
  {
    id: 'c9527ce2-97cd-425f-abff-f0c20e5176aa',
    name: 'آموزش پایتون',
    basePrice: 20000,
    stock: 1000,
    images: [] as string[],
    description: `اگر می‌خوای وارد دنیای برنامه‌نویسی بشی و نمی‌دونی از کجا شروع کنی، این دوره برای توئه!

در دوره جامع آموزش پایتون، از صفر شروع می‌کنی و قدم‌به‌قدم با مفاهیم برنامه‌نویسی و زبان Python آشنا می‌شی. در طول ۳۰ ساعت آموزش ویدئویی، مفاهیم رو یاد می‌گیری، تمرین حل می‌کنی و با انجام پروژه‌های عملی، دانسته‌هات رو به مهارت تبدیل می‌کنی.

این دوره برای چه کسانی مناسبه؟
افرادی که هیچ تجربه‌ای در برنامه‌نویسی ندارن و می‌خوان از صفر شروع کنن.
کسانی که قصد دارن وارد بازار کار برنامه‌نویسی بشن.
دانشجوها و علاقه‌مندانی که می‌خوان مهارت فنی خودشون رو افزایش بدن.
افرادی که به هوش مصنوعی، تحلیل داده، توسعه وب یا اتوماسیون علاقه دارن.
کسانی که می‌خوان به‌جای آموزش‌های پراکنده، یک مسیر یادگیری منظم داشته باشن.`,
  },
  {
    id: '54a65651-8c73-4978-8406-4454222ee0c1',
    name: 'آموزش react',
    basePrice: 10000,
    stock: 1000,
    images: [] as string[],
    description: 'آموزش react.js',
  },
];

type Product = (typeof PRODUCTS)[number];
type CartItem = {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
};

const DESCRIPTION_FACTS_MAX_CHARS = 700;
function truncateDescriptionForFacts(description: string): string {
  if (description.length <= DESCRIPTION_FACTS_MAX_CHARS) return description;
  return `${description.slice(0, DESCRIPTION_FACTS_MAX_CHARS)}...`;
}

function cartTotal(cart: CartItem[]): number {
  return cart.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
}

function catalogFacts(
  products: Product[],
  persuasion?: PersuasionConfig,
): string {
  if (products.length === 0) return 'فعلاً هیچ محصولی در فروشگاه نیست.';
  return `این محصولات فروشگاه است: ${products
    .map(
      (p) =>
        `${p.name} (شناسه: ${p.id}, ${p.basePrice} تومان)${p.stock === 0 ? ' — فعلاً ناموجود' : ''}${
          p.description
            ? ` — توضیحات: ${truncateDescriptionForFacts(p.description)}`
            : ''
        }${buildPersuasionNote(p, persuasion)}`,
    )
    .join('، ')}`;
}

// عیناً کپی buildFullAgentSystemPrompt (conversation-engine.service.ts)
function buildSystemPrompt(
  cart: CartItem[],
  transcript: string[],
  nudgeActive: boolean,
  persuasion?: PersuasionConfig,
): string {
  const tone = toneForCategory(STORE.category);
  const storeProfile = [
    STORE.category && `حوزه‌ی فعالیت: ${STORE.category}`,
    STORE.brandIntro && `معرفی فروشگاه: ${STORE.brandIntro}`,
    STORE.shippingInfo && `ارسال: ${STORE.shippingInfo}`,
    STORE.returnPolicy && `شرایط مرجوعی/گارانتی: ${STORE.returnPolicy}`,
  ]
    .filter(Boolean)
    .join('\n');
  const cartSummary = cart.length
    ? `سبد فعلی مشتری: ${cart.map((i) => `${i.name} × ${i.qty}`).join('، ')} — جمع ${cartTotal(cart)} تومان`
    : 'سبد فعلی مشتری خالی است.';
  const transcriptText = transcript.slice(-8).join('\n');

  return `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی و با ابزارهای زیر مستقیماً سبد/
سفارش مشتری را مدیریت می‌کنی، نه فقط متن می‌نویسی. لحن نوشتار باید ${tone} باشد.
${storeProfile ? `\nاطلاعات فروشگاه:\n${storeProfile}\n` : ''}
کاتالوگ اولیه (برای جست‌وجوی دقیق‌تر یا محصولی که اینجا نیست از search_products استفاده کن):
${catalogFacts(PRODUCTS, persuasion)}

${cartSummary}
${
  transcriptText
    ? `\nتاریخچه‌ی اخیر مکالمه (حتماً برای فهمیدن منظور پیام‌های ناقص/ادامه‌دار مشتری — مثل «پس اگه بخوام X بشم چی؟» بعد از بحث قبلی — این را در نظر بگیر):\n${transcriptText}\n`
    : ''
}
قوانین حیاتی:
- هیچ عدد/اسم/شماره‌ای که از ابزارها یا واقعیت‌های بالا نیامده اختراع نکن.
- هرگز تعداد دقیق موجودی انبار را اعلام نکن، فقط «موجود است» یا «فعلاً ناموجود».
- قبل از هر ادعای قیمت/موجودی/جزئیات محصولی که در کاتالوگ اولیه نبود، حتماً search_products یا
  get_product_details را صدا بزن — حدس نزن.
- افزودن/حذف واقعی از سبد فقط با update_cart انجام می‌شود؛ هرگز فقط در متن بگو «به سبد اضافه
  کردم» بدون این‌که واقعاً این ابزار را صدا زده باشی.
- ثبت نهایی سفارش فقط با create_order انجام می‌شود، و فقط وقتی مشتری صریحاً تایید خرید کرده
  (نه صرفاً علاقه نشان داده).
- اگر مشتری مشکل پرداخت یا سوال پس از خرید (مثل سفارش قبلاً ثبت‌شده) دارد که با ابزارهای بالا
  قابل‌حل نیست، یا صریح خواست با یک آدم/پشتیبان صحبت کند، request_human_handoff را صدا بزن و
  دیگر respond_to_customer را صدا نزن — مکالمه همان‌جا تمام می‌شود.
- اگر مشتری صریح عکس بیشتر خواست، از show_product_photos استفاده کن.
- (docs/PRD-sales-agent-consultative-recommendation.md) اگر پیام مشتری توصیف یک وضعیت/مشکل/هدف
  است (نه اسم مشخص یک محصول)، مثل یک مشاور رفتار کن: اگر با قطعیت می‌دانی کدام محصول واقعی
  مناسب است، همان یکی (حداکثر دو تای کاملاً هم‌سطح) را با توضیح کوتاهِ *چرا* دقیقاً برای همین نیاز
  مناسب است پیشنهاد بده — نه تعریف کلی/تبلیغاتی. اگر واقعاً مطمئن نیستی، به‌جای حدس‌زدن یک سوال
  کوتاه و مشخص بپرس تا هدف را دقیق‌تر کنی؛ در این حالت هیچ محصولی نام نبر و relevantProductIds را
  خالی بگذار. لازم نیست عبارت جست‌وجو دقیقاً با اسم محصول یکی باشد — search_products روی
  توضیحات هم جست‌وجو می‌کند و اگر هیچ‌چیز پیدا نکرد کل کاتالوگ را برمی‌گرداند تا خودت تناسب را
  تشخیص بدهی.
- در پایان (مگر وقتی request_human_handoff زده‌ای)، همیشه دقیقاً یک‌بار respond_to_customer را
  به‌عنوان آخرین قدم صدا بزن؛ relevantProductIds می‌تواند شامل شناسه‌ی هر محصولی باشد که از
  کاتالوگ اولیه یا ابزارها واقعاً دیده‌ای، نه فقط کاندیدهای اولیه.${
    persuasion?.enabled ? `\n\n${PERSUASION_INSTRUCTION}` : ''
  }${
    persuasion?.enabled && persuasion.urgentDiscount
      ? `\n\nیک کد تخفیف واقعی و زمان‌دار همین الان فعال است: «${persuasion.urgentDiscount.code}»، ${persuasion.urgentDiscount.hoursLeftText}. اگر به مکالمه مرتبط است، می‌توانی طبیعی مطرحش کنی، حتی اگر مشتری نپرسیده — وگرنه لازم نیست اشاره کنی.`
      : ''
  }${nudgeActive ? `\n\n${OPEN_QUESTION_NUDGE_INSTRUCTION}` : ''}`;
}

type TurnResult = {
  text: string;
  relevantProductIds: string[];
  toolsCalled: string[];
  progressHappened: boolean;
  handoff: boolean;
  cart: CartItem[];
  inputTokens: number;
  outputTokens: number;
  error?: string;
  persuasionTechniquesUsed: string[];
  usedGeneralKnowledge: boolean;
};

async function runTurn(
  client: Parameters<typeof generateText>[0]['model'],
  cart: CartItem[],
  transcript: string[],
  openQuestionStreak: number,
  customerMessage: string,
  persuasion?: PersuasionConfig,
): Promise<TurnResult> {
  let localCart = [...cart];
  let progressHappened = false;
  let handoff = false;
  const toolsCalled: string[] = [];
  const nudgeActive = openQuestionStreak >= OPEN_QUESTION_NUDGE_THRESHOLD;

  const search_products = tool({
    description:
      'در کاتالوگ فروشگاه جست‌وجو می‌کند — هم روی نام هم روی توضیحات محصول. برای پیام‌های ' +
      'نیازمحور هم کاربرد دارد؛ اگر هیچ تطابقی پیدا نشود کل کاتالوگ برگردانده می‌شود.',
    inputSchema: z.object({ query: z.string() }),
    execute: ({ query }: { query: string }) => {
      toolsCalled.push('search_products');
      const q = query.toLowerCase();
      const literalMatches = PRODUCTS.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q),
      );
      const results = literalMatches.length > 0 ? literalMatches : PRODUCTS;
      return results.map((p) => ({
        id: p.id,
        name: p.name,
        basePrice: p.basePrice,
        inStock: p.stock > 0,
        description: p.description
          ? truncateDescriptionForFacts(p.description)
          : null,
      }));
    },
  });

  const get_product_details = tool({
    description: 'جزئیات کامل یک محصول را با شناسه‌اش برمی‌گرداند',
    inputSchema: z.object({ productId: z.string() }),
    execute: ({ productId }: { productId: string }) => {
      toolsCalled.push('get_product_details');
      const product = PRODUCTS.find((p) => p.id === productId);
      if (!product) return { error: 'محصولی با این شناسه پیدا نشد' };
      return {
        id: product.id,
        name: product.name,
        basePrice: product.basePrice,
        inStock: product.stock > 0,
        description: truncateDescriptionForFacts(product.description),
      };
    },
  });

  const update_cart = tool({
    description: 'محصولی را به سبد مشتری اضافه یا از آن حذف می‌کند',
    inputSchema: z.object({
      productId: z.string(),
      qty: z.number().optional(),
      remove: z.boolean().optional(),
    }),
    execute: ({
      productId,
      qty,
      remove,
    }: {
      productId: string;
      qty?: number;
      remove?: boolean;
    }) => {
      toolsCalled.push('update_cart');
      const product = PRODUCTS.find((p) => p.id === productId);
      if (!product) return { error: 'محصولی با این شناسه پیدا نشد' };
      if (remove) {
        localCart = localCart.filter((i) => i.productId !== productId);
      } else {
        if (product.stock < (qty ?? 1)) return { error: 'موجودی کافی نیست' };
        const idx = localCart.findIndex((i) => i.productId === productId);
        if (idx >= 0)
          localCart[idx] = {
            ...localCart[idx],
            qty: localCart[idx].qty + (qty ?? 1),
          };
        else
          localCart.push({
            productId,
            name: product.name,
            unitPrice: product.basePrice,
            qty: qty ?? 1,
          });
        progressHappened = true;
      }
      return {
        cart: localCart.map((i) => ({
          name: i.name,
          qty: i.qty,
          unitPrice: i.unitPrice,
        })),
        total: cartTotal(localCart),
      };
    },
  });

  const view_cart = tool({
    description: 'محتوای فعلی سبد مشتری را برمی‌گرداند',
    inputSchema: z.object({}),
    execute: () => ({
      cart: localCart.map((i) => ({
        name: i.name,
        qty: i.qty,
        unitPrice: i.unitPrice,
      })),
      total: cartTotal(localCart),
    }),
  });

  const create_order = tool({
    description: 'سفارش نهایی را از روی سبد فعلی ثبت می‌کند',
    inputSchema: z.object({}),
    execute: () => {
      toolsCalled.push('create_order');
      if (localCart.length === 0) return { error: 'سبد خالی است' };
      progressHappened = true;
      return {
        amount: cartTotal(localCart),
        cardNumber: '6037-XXXX-XXXX-1234',
        ownerName: 'فروشگاه نمونه',
      };
    },
  });

  const cancel_order = tool({
    description: 'سبد فعلی را کاملاً خالی می‌کند',
    inputSchema: z.object({}),
    execute: () => {
      toolsCalled.push('cancel_order');
      localCart = [];
      return { ok: true };
    },
  });

  const answer_faq = tool({
    description:
      'جواب واقعی یک سؤال را جست‌وجو می‌کند (شبیه‌سازی‌شده: فقط از روی توضیح محصولات)',
    inputSchema: z.object({ question: z.string() }),
    execute: ({ question }: { question: string }) => {
      toolsCalled.push('answer_faq');
      void question;
      return { matched: false };
    },
  });

  const request_human_handoff = tool({
    description: 'مکالمه را به یک فروشنده‌ی انسانی ارجاع می‌دهد',
    inputSchema: z.object({ reason: z.string().optional() }),
    execute: () => {
      toolsCalled.push('request_human_handoff');
      handoff = true;
      return { done: true };
    },
  });

  const show_product_photos = tool({
    description: 'همه‌ی عکس‌های یک محصول را برمی‌گرداند',
    inputSchema: z.object({ productId: z.string() }),
    execute: ({ productId }: { productId: string }) => {
      toolsCalled.push('show_product_photos');
      const product = PRODUCTS.find((p) => p.id === productId);
      if (!product || product.images.length === 0)
        return { error: 'عکسی پیدا نشد' };
      return { images: product.images };
    },
  });

  // عیناً همون منطق conversation-engine.service.ts — وقتی persuasion خاموشه، این دو فیلد اصلاً
  // در schema نیستند (نه فقط optional) چون تست زنده نشان داد وگرنه مدل بدون تعریف ۶ اصل در
  // پرامپت مجبور به حدس‌زدن می‌شود و برچسب غلط می‌سازد
  const respond_to_customer = tool({
    description: 'پاسخ نهایی به مشتری را اعلام می‌کند',
    inputSchema: persuasion?.enabled
      ? z.object({
          text: z.string(),
          relevantProductIds: z.array(z.string()),
          persuasionTechniquesUsed: z.array(
            z.enum([
              'COMMITMENT_CONSISTENCY',
              'SOCIAL_PROOF',
              'AUTHORITY',
              'LIKING',
              'RECIPROCITY',
              'SCARCITY',
            ]),
          ),
          usedGeneralKnowledge: z.boolean(),
        })
      : z.object({
          text: z.string(),
          relevantProductIds: z.array(z.string()),
        }),
  });

  try {
    const result = await generateText({
      model: client,
      tools: {
        search_products,
        get_product_details,
        update_cart,
        view_cart,
        create_order,
        cancel_order,
        answer_faq,
        request_human_handoff,
        show_product_photos,
        respond_to_customer,
      },
      stopWhen: stepCountIs(6),
      system: buildSystemPrompt(cart, transcript, nudgeActive, persuasion),
      prompt: customerMessage,
      temperature: 0.3,
    });

    if (handoff) {
      return {
        text: '[ارجاع به انسان]',
        relevantProductIds: [],
        toolsCalled,
        progressHappened,
        handoff: true,
        cart: localCart,
        inputTokens: result.usage.inputTokens ?? 0,
        outputTokens: result.usage.outputTokens ?? 0,
        persuasionTechniquesUsed: [],
        usedGeneralKnowledge: false,
      };
    }

    const finalCall = result.toolCalls.find(
      (c) => c.toolName === 'respond_to_customer',
    ) as
      | {
          input: {
            text: string;
            relevantProductIds: string[];
            persuasionTechniquesUsed?: string[];
            usedGeneralKnowledge?: boolean;
          };
        }
      | undefined;
    if (!finalCall) {
      throw new Error('respond_to_customer صدا زده نشد (به سقف قدم رسید)');
    }
    return {
      text: finalCall.input.text.trim(),
      relevantProductIds: finalCall.input.relevantProductIds ?? [],
      toolsCalled,
      progressHappened,
      handoff: false,
      cart: localCart,
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      persuasionTechniquesUsed: finalCall.input.persuasionTechniquesUsed ?? [],
      usedGeneralKnowledge: !!finalCall.input.usedGeneralKnowledge,
    };
  } catch (err) {
    return {
      text: '',
      relevantProductIds: [],
      toolsCalled,
      progressHappened,
      handoff: false,
      cart: localCart,
      inputTokens: 0,
      outputTokens: 0,
      error: err instanceof Error ? err.message : 'خطای نامشخص',
      persuasionTechniquesUsed: [],
      usedGeneralKnowledge: false,
    };
  }
}

async function runConversation(
  client: Parameters<typeof generateText>[0]['model'],
  label: string,
  messages: string[],
  persuasion?: PersuasionConfig,
) {
  console.log(`\n\n== ${label} ==`);
  let cart: CartItem[] = [];
  const transcript: string[] = [];
  let openQuestionStreak = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const startedAt = Date.now();

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const turnStarted = Date.now();
    const r = await runTurn(
      client,
      cart,
      transcript,
      openQuestionStreak,
      message,
      persuasion,
    );
    const latencyMs = Date.now() - turnStarted;
    totalInputTokens += r.inputTokens;
    totalOutputTokens += r.outputTokens;

    console.log(`\n--- نوبت ${i + 1} ---`);
    console.log(`📩 مشتری: «${message}»`);
    console.log(
      `   openQuestionStreak قبل از این نوبت: ${openQuestionStreak}${
        openQuestionStreak >= OPEN_QUESTION_NUDGE_THRESHOLD
          ? ' (نادج فعال بود)'
          : ''
      }`,
    );
    if (r.error) {
      console.log(`   💥 خطا: ${r.error}`);
      continue;
    }
    console.log(
      `   🔧 ابزارهای صدا‌زده‌شده: ${r.toolsCalled.join(', ') || '—'}`,
    );
    console.log(`   💬 پاسخ: «${r.text}»`);
    if (r.relevantProductIds.length) {
      const names = r.relevantProductIds.map(
        (id) => PRODUCTS.find((p) => p.id === id)?.name ?? id,
      );
      console.log(`   🛍️  محصولات مرتبط: ${names.join(' + ')}`);
    }
    if (r.persuasionTechniquesUsed.length || r.usedGeneralKnowledge) {
      console.log(
        `   🧲 متقاعدسازی خوداظهاری‌شده: ${r.persuasionTechniquesUsed.join('، ') || '—'}${r.usedGeneralKnowledge ? ' + دانش عمومی AI' : ''}`,
      );
    }
    console.log(
      `   ⏱️  تاخیر: ${latencyMs}ms — توکن: in=${r.inputTokens} out=${r.outputTokens}`,
    );

    cart = r.cart;
    transcript.push(`مشتری: ${message}`);
    transcript.push(`فروشنده: ${r.text}`);
    openQuestionStreak = r.progressHappened ? 0 : openQuestionStreak + 1;
    if (r.handoff) break;
  }

  console.log(
    `\n   جمع‌کل این مکالمه: ${Date.now() - startedAt}ms — توکن: in=${totalInputTokens} out=${totalOutputTokens}`,
  );
}

async function main() {
  const variantKey = process.argv[2] ?? DEFAULT_VARIANT_KEY;
  const model = resolveModel(variantKey);
  const aiProvider = new AiProviderService(fakeConfig);
  const client = aiProvider.buildClient(undefined, {
    supportsStructuredOutputs: true,
  })(model);

  console.log(
    `== تست end-to-end واقعی FULL_AGENT (فروشگاه نهایت یادگیری) — مدل: ${variantKey} (${model}) ==`,
  );

  // سناریوی ۱ — عیناً همون مکالمه‌ی واقعی‌ای که کاربر زنده تست کرد و شکست خورد
  await runConversation(
    client,
    'سناریوی ۱ — ترانسکریپت واقعی شکست‌خورده (باگ فالو-آپ)',
    [
      'سلام، محصولاتتون رو نشون بدید',
      'میخوام برنامه نویس فرانت اند بشم',
      'این دوره ها به چه دردی میخورن؟',
      'خب با کدوم میتونم سریعتر کار پیدا کنم؟',
      'من اگر بخوام فرانت بشم چی؟',
    ],
  );

  // سناریوی ۲ — تست مکانیزم نادج (بخش ۴): فقط سوال اطلاعاتی، هیچ‌وقت تصمیم خرید
  await runConversation(
    client,
    'سناریوی ۲ — تست نادج (۴ سوال اطلاعاتی پشت‌سرهم)',
    [
      'سلام، چی دارید؟',
      'دوره react چند ساعته؟',
      'برای شروع کدومو پیشنهاد میدی؟',
      'خب فرقشون با هم چیه دقیقا؟',
    ],
  );

  // سناریوی ۳ — مسیر خرید کامل (update_cart → create_order) باید عدد/شماره‌کارت واقعی بدهد
  await runConversation(client, 'سناریوی ۳ — مسیر خرید کامل', [
    'آموزش react رو میخوام',
    'باشه همینو بذار تو سبد',
    'تایید میکنم، میخوام پرداخت کنم',
  ]);

  // docs/PRD-sales-agent-persuasion-principles.md — سناریوی ۴: متقاعدسازی روشن + سیگنال‌های
  // واقعی (نظرات/شمار سفارش/کم‌موجودی/تخفیف زمان‌دار) روی آموزش react — باید طبیعی ازشون استفاده
  // کند، هم محصول شناخته‌شده (react) هم سیگنال داخلی واقعی را
  await runConversation(
    client,
    'سناریوی ۴ — متقاعدسازی روشن با سیگنال‌های واقعی',
    [
      'میخوام یاد بگیرم فرانت‌اند کار کنم، کدومو پیشنهاد میدی؟',
      'نظر بقیه چی بوده راجبش؟',
    ],
    {
      enabled: true,
      lowStockProductId: '54a65651-8c73-4978-8406-4454222ee0c1',
      urgentDiscount: {
        code: 'FALL20',
        hoursLeftText: 'فقط تا ۴۸ ساعت دیگه معتبره',
      },
    },
  );

  // سناریوی ۵ — همون سوال دقیقاً، ولی کلید خاموش — نباید هیچ‌کدام از سیگنال‌ها/دانش عمومی ظاهر شود
  await runConversation(
    client,
    'سناریوی ۵ — همون سوال، کلید متقاعدسازی خاموش (کنترل)',
    [
      'میخوام یاد بگیرم فرانت‌اند کار کنم، کدومو پیشنهاد میدی؟',
      'نظر بقیه چی بوده راجبش؟',
    ],
    { enabled: false },
  );

  // docs/PRD-sales-agent-consultative-recommendation.md — سناریوی ۶: پیام کاملاً نیازمحور
  // (اسم هیچ محصولی نیامده) که توضیحات «آموزش پایتون» دقیقاً برایش نوشته شده («هیچ تجربه‌ای
  // ندارن»/«وارد بازار کار بشن») در حالی‌که «آموزش react» فقط یک توضیح یک‌خطی دارد — انتظار:
  // باید به پایتون برسد، نه react، و توجیهش را به حرف مشتری وصل کند نه تعریف کلی
  await runConversation(
    client,
    'سناریوی ۶ — تست حالت مشاوره (پیام نیازمحور، بدون اسم محصول)',
    [
      'من هیچی از برنامه‌نویسی بلد نیستم ولی می‌خوام وارد بازار کارش بشم، از کجا شروع کنم؟',
    ],
  );

  console.log('\n\n== نکاتی که باید دستی چک شود ==');
  console.log(
    '۱. سناریوی ۱ نوبت ۵ — آیا واقعاً فهمید «فرانت» = آموزش react (نه «متوجه نشدم»)؟',
  );
  console.log(
    '۲. سناریوی ۲ نوبت ۴ — آیا پاسخ با پیشنهاد مشخص+دعوت به سبد تمام شد (نادج)؟',
  );
  console.log(
    '۳. سناریوی ۳ — آیا مبلغ/شماره‌کارت نهایی دقیقاً همون چیزیه که create_order برگردوند (نه عدد ساختگی مدل)؟',
  );
  console.log(
    '۴. در هیچ‌کدام، آیا عدد موجودی انبار (۱۰۰۰) مستقیم اعلام شده؟ (نباید بشه)',
  );
  console.log(
    '۵. سناریوی ۶ — آیا به «آموزش پایتون» رسید (نه react)، و توجیهش را به حرف مشتری (صفر/بازار کار) وصل کرد؟',
  );
  console.log(
    '۵. سناریوی ۴ — آیا نظرات واقعی/۴۲ سفارش/کم‌موجود/تخفیف واقعاً در پاسخ‌ها ظاهر شد، نه ساختگی؟',
  );
  console.log(
    '۶. سناریوی ۴ — آیا یک جمله‌ی کوتاه دانش عمومی درباره‌ی محبوبیت/بازار کار react هم دیده شد؟',
  );
  console.log(
    '۷. سناریوی ۵ — آیا با خاموش‌بودن کلید، هیچ‌کدام از سیگنال‌های بالا (حتی دانش عمومی) ظاهر نشد؟',
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('اجرای تست شکست خورد:', err);
    process.exit(1);
  });
