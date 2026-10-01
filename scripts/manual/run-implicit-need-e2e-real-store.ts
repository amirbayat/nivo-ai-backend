// docs/PRD-sales-agent-implicit-need-detection.md — تست end-to-end واقعی، نه فقط schema
// طبقه‌بندی: کل مسیر واقعی doBrowse (classify → searchProducts → fit-check چندمحصولی) را روی
// داده‌ی واقعی فروشگاه پایلوت «نهایت یادگیری» (نه synthetic) شبیه‌سازی می‌کند، چون سوال واقعی
// این بود: «AI که می‌دونه react.js یعنی فرانت‌اند، می‌تونه این رو به description خیلی کوتاه
// محصول وصل کنه یا نه؟» — این را فقط با تست زنده می‌شود فهمید، نه با خواندن کد.
//
// docs/PRD-sales-agent-response-strategy-ab.md فاز ۱ — جدول تصمیم Track A هم همین‌جا اضافه
// شده: پیتریدینس NEEDS_CLARIFICATION (askClarifyingQuestion) و
// needType=IMPLICIT+storeRelevance=RELEVANT+pitchReadiness=READY (bridgeAndPitch).
//
// منطق doBrowse/callCaption/callCaptionWithRelevance/callAskClarifyingQuestion
// (conversation-engine.service.ts) این‌جا عیناً بازسازی شده چون متدهای private کلاس‌اند و بدون
// بوت کامل Nest/DB قابل فراخوانی مستقیم نیستند؛ هر تغییر در آن متدها باید دستی این‌جا هم اعمال شود.
//
// اجرا: npx ts-node --transpile-only scripts/manual/run-implicit-need-e2e-real-store.ts [variantKey]
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

loadEnv({ path: resolve(__dirname, '../../../.env') });
loadEnv({ path: resolve(__dirname, '../../.env.localtest'), override: false });

import type { ConfigService } from '@nestjs/config';
import { generateObject, generateText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { AiProviderService } from '../../src/common/services/ai-provider.service';
import {
  resolveModel,
  DEFAULT_VARIANT_KEY,
} from '../../src/modules/sales-agent/model-variants';
import {
  buildIntentClassificationPrompt,
  intentClassificationSchema,
} from '../../src/modules/sales-agent/intent-classification.schema';
import { toneForCategory } from '../../src/modules/sales-agent/tone-by-category';

const fakeConfig = {
  get: (key: string) => process.env[key],
} as unknown as ConfigService;

// داده‌ی واقعی — از کوئری SELECT فقط-خواندنی که کاربر روی DB پروداکشن اجرا کرد (۱۴۰۵/۰۷/۱۱)،
// نه ساختگی
const STORE = {
  category: 'سایر',
  // برندِ intro واقعی فروشگاه در دسترس نبود؛ اگر بعداً کاربر دادش، اینجا جایگزین شود
  brandIntro: null as string | null,
};
const PRODUCTS = [
  {
    id: 'c9527ce2-97cd-425f-abff-f0c20e5176aa',
    name: 'آموزش پایتون',
    basePrice: 20000,
    stock: 1000,
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
    description: 'آموزش react.js',
  },
];

const DESCRIPTION_FACTS_MAX_CHARS = 700;
function truncateDescriptionForFacts(description: string): string {
  if (description.length <= DESCRIPTION_FACTS_MAX_CHARS) return description;
  return `${description.slice(0, DESCRIPTION_FACTS_MAX_CHARS)}...`;
}

function buildFacts(products: typeof PRODUCTS): string {
  return `این محصولات فروشگاه است: ${products
    .map(
      (p) =>
        `${p.name} (${p.basePrice} تومان)${p.stock === 0 ? ' — فعلاً ناموجود' : ''}${
          p.description
            ? ` — توضیحات: ${truncateDescriptionForFacts(p.description)}`
            : ''
        }`,
    )
    .join('، ')}`;
}

// عیناً کپی سیستم‌پرامپت callCaptionWithRelevance (conversation-engine.service.ts)
function buildRelevanceSystemPrompt(
  category: string | null,
  candidateProductIds: string[],
  customerQuestion: string | undefined,
  skipGreeting: boolean,
  bridgeNeedSummary?: string | null,
): string {
  const tone = toneForCategory(category);
  return `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی. فقط و فقط از «واقعیت‌های»
داده‌شده یک پیام فارسی کوتاه (حداکثر ۲-۳ جمله)، دوستانه و محاوره‌ای بساز — هیچ عدد/اسم/شماره‌ی
تازه‌ای که در واقعیت‌ها نیامده اضافه نکن، و پیشنهاد بعدی اختراع نکن. هرگز تعداد دقیق موجودی
انبار را اعلام نکن (حتی اگر مشتری صریح بپرسد)، فقط «موجود است» یا «فعلاً ناموجود».
لحن نوشتار باید ${tone} باشد.${
    customerQuestion
      ? '\nمشتری زیر «سوال مشتری» یک سوال مشخص پرسیده — مستقیم و دقیق با استفاده از همین واقعیت‌ها جوابش را بده؛ اگر واقعیت‌ها جوابش را ندارند، صادقانه بگو که این اطلاعات را نداری.'
      : ''
  }${
    bridgeNeedSummary
      ? `\nهدف واقعی مشتری (نه اسم محصول): «${bridgeNeedSummary}». ابتدا در یک جمله‌ی کوتاه نشان بده این هدف را فهمیده‌ای، بعد با یک جمله‌ی کوتاه پل بزن که چرا محصول(های) پیشنهادی به این هدف کمک می‌کنند، و در آخر محصول را معرفی کن — نه برعکس.`
      : ''
  }
علاوه‌بر متن پاسخ، باید تصمیم بگیری در relevantProductIds چند و کدام محصول برگردانی — دقیقاً
همین ترتیب را رعایت کن:
۱. اگر مشتری نیاز/سؤال مشخصی دارد و یک محصول به‌تنهایی جوابش است (مثلاً «برای فرانت‌اند کدوم
بهتره؟» با یک برنده‌ی مشخص)، فقط همان یک شناسه را برگردان — تعداد کمتر همیشه بهتر از توضیح
پراکنده است.
۲. وگرنه اگر مشتری معرفی کلی/چندتایی می‌خواهد، حداکثر ۳ تای مرتبط‌ترین کاندید را برگردان —
هرگز کورکورانه همه‌ی کاندیدها را برنگردان و هرگز بیشتر از ۳ تا.
شناسه‌های کاندید: ${candidateProductIds.join(', ')}${
    skipGreeting
      ? '\nیک پیام خوش‌آمد جداگانه همین الان قبل از این متن برای مشتری فرستاده شده — فیلد text را هرگز با «سلام»/«خوش اومدی»/هر نوع احوال‌پرسی شروع نکن، مستقیم برو سراغ محتوا.'
      : ''
  }`;
}

// عیناً کپی سیستم‌پرامپت callCaption (conversation-engine.service.ts) — فقط برای شاخه‌ی
// bridgeAndPitch با دقیقاً یک محصول کاندید لازم است (شاخه‌ی NORMAL تک‌کاندید بدون تغییر مانده،
// پس نیازی به بازسازی آن متن این‌جا نیست)
function buildCaptionSystemPrompt(
  category: string | null,
  customerQuestion: string | undefined,
  skipGreeting: boolean,
  bridgeNeedSummary?: string | null,
): string {
  const tone = toneForCategory(category);
  return `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی. فقط و فقط از «واقعیت‌های»
داده‌شده یک پیام فارسی کوتاه (حداکثر ۲-۳ جمله)، دوستانه و محاوره‌ای بساز — هیچ عدد/اسم/شماره‌ی
تازه‌ای که در واقعیت‌ها نیامده اضافه نکن، و پیشنهاد بعدی اختراع نکن. هرگز تعداد دقیق موجودی
انبار را اعلام نکن (حتی اگر مشتری صریح بپرسد)، فقط «موجود است» یا «فعلاً ناموجود».
لحن نوشتار باید ${tone} باشد.${
    customerQuestion
      ? '\nمشتری زیر «سوال مشتری» یک سوال مشخص پرسیده — مستقیم و دقیق با استفاده از همین واقعیت‌ها جوابش را بده؛ اگر واقعیت‌ها جوابش را ندارند، صادقانه بگو که این اطلاعات را نداری.'
      : ''
  }${
    bridgeNeedSummary
      ? `\nهدف واقعی مشتری (نه اسم محصول): «${bridgeNeedSummary}». ابتدا در یک جمله‌ی کوتاه نشان بده این هدف را فهمیده‌ای، بعد با یک جمله‌ی کوتاه پل بزن که چرا این محصول به این هدف کمک می‌کند، و در آخر محصول را معرفی کن — نه برعکس.`
      : ''
  }${
    skipGreeting
      ? '\nیک پیام خوش‌آمد جداگانه همین الان قبل از این متن برای مشتری فرستاده شده — این پیام را هرگز با «سلام»/«خوش اومدی»/هر نوع احوال‌پرسی شروع نکن، مستقیم برو سراغ محتوا.'
      : ''
  }`;
}

// عیناً کپی سیستم‌پرامپت callAskClarifyingQuestion (conversation-engine.service.ts)
function buildAskClarifyingQuestionSystemPrompt(
  category: string | null,
  needSummary: string,
  skipGreeting: boolean,
): string {
  const tone = toneForCategory(category);
  return `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی. مشتری یک هدف کلی دارد
(«${needSummary}») ولی هنوز اطلاعات کافی برای پیشنهاد دقیق محصول نداری. فقط بر اساس «واقعیت‌های»
زیر (محصولات واقعی فروشگاه)، یک پیام فارسی کوتاه (حداکثر ۱-۲ جمله) و ${tone} بساز که دقیقاً یک
سوال مشخص بپرسد تا بفهمی کدام محصول را پیشنهاد بدهی. هیچ محصولی را در این مرحله نام نبر یا پیشنهاد
نکن، و هیچ عدد/اسم تازه‌ای که در واقعیت‌ها نیامده اختراع نکن.${
    skipGreeting
      ? '\nیک پیام خوش‌آمد جداگانه همین الان قبل از این متن برای مشتری فرستاده شده — این پیام را هرگز با «سلام»/«خوش اومدی»/هر نوع احوال‌پرسی شروع نکن، مستقیم برو سراغ سوال.'
      : ''
  }`;
}

// عیناً کپی سیستم‌پرامپت callAgentCaptionWithRelevance (conversation-engine.service.ts، بخش
// Track B) — توجه: این‌جا bridge/clarify signal از بیرون داده نمی‌شود، خودِ agent با ابزار
// تصمیم می‌گیرد
function buildAgentSystemPrompt(
  category: string | null,
  candidateProductIds: string[],
  customerQuestion: string | undefined,
  skipGreeting: boolean,
): string {
  const tone = toneForCategory(category);
  return `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی. لحن نوشتار باید ${tone}
باشد. کاندیدهای اولیه‌ای که از جست‌وجوی پیام مشتری پیدا شده‌اند، پایین در «واقعیت‌ها» آمده‌اند
(نام/قیمت/موجودی/توضیحات). قبل از تصمیم نهایی لازم نیست حتماً ابزاری صدا بزنی — اگر واقعیت‌های
داده‌شده برای تصمیم کافی‌اند، مستقیم respond_to_customer را صدا بزن.
فقط و فقط بر اساس واقعیت‌های واقعی (داده‌شده یا از ابزارها) تصمیم بگیر — هیچ عدد/اسم/شماره‌ی
تازه‌ای که در این واقعیت‌ها نیامده اختراع نکن، و هرگز تعداد دقیق موجودی انبار را اعلام نکن (حتی
اگر مشتری صریح بپرسد)، فقط «موجود است» یا «فعلاً ناموجود».
تصمیم نهایی را با respond_to_customer اعلام کن (دقیقاً یک‌بار، به‌عنوان آخرین قدم):
۱. اگر هدف واقعی مشتری و تناسبش با یکی از محصولات برایت روشن است، یک پیام کوتاه و دوستانه با
حداکثر ۳ شناسه‌ی مرتبط‌ترین محصول بساز (اگر یک محصول به‌تنهایی برنده‌ی مشخصی است، فقط همان یکی).
۲. اگر هدف مشتری کلی/مبهم است و واقعاً نمی‌توانی مطمئن باشی کدام محصول مناسب است، به‌جای حدس
کورکورانه فقط یک سوال کوتاه و مشخص بپرس تا هدف را دقیق‌تر کنی — در این حالت هیچ محصولی نام نبر و
relevantProductIds را خالی بگذار.${
    customerQuestion
      ? '\nمشتری زیر «سوال مشتری» یک سوال مشخص پرسیده — اگر واقعیت‌ها جوابش را می‌دهند، مستقیم و دقیق جواب بده؛ اگر نه، صادقانه بگو این اطلاعات را نداری (این هم یک پاسخ معتبر است، نیازی به سوال روشن‌کننده نیست).'
      : ''
  }${
    skipGreeting
      ? '\nیک پیام خوش‌آمد جداگانه همین الان قبل از این پاسخ برای مشتری فرستاده شده — فیلد text را هرگز با «سلام»/«خوش اومدی»/هر نوع احوال‌پرسی شروع نکن.'
      : ''
  }
شناسه‌های کاندید اولیه: ${candidateProductIds.join(', ')}`;
}

type BranchB = 'CLARIFY' | 'ANSWER';

// عیناً معادل callAgentCaptionWithRelevance ولی ابزارها به‌جای Prisma واقعی، روی آرایه‌ی
// درون‌حافظه‌ای PRODUCTS کار می‌کنند (بدون بوت Nest/DB)
async function runTrackB(
  client: Parameters<typeof generateText>[0]['model'],
  candidates: typeof PRODUCTS,
  customerMessage: string,
  skipGreeting: boolean,
): Promise<{
  branch: BranchB;
  matchedProductNames: string[];
  replyText: string;
}> {
  const getProductDetails = tool({
    description:
      'جزئیات کامل یک محصول (توضیحات کامل، قیمت، موجودی) را با شناسه‌اش برمی‌گرداند',
    inputSchema: z.object({ productId: z.string() }),
    execute: ({ productId }: { productId: string }) => {
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
  const searchProductsTool = tool({
    description: 'در کاتالوگ فروشگاه بر اساس یک عبارت جست‌وجو می‌کند',
    inputSchema: z.object({ query: z.string() }),
    execute: ({ query }: { query: string }) => {
      const results = PRODUCTS.filter((p) =>
        p.name.toLowerCase().includes(query.toLowerCase()),
      );
      return results.map((p) => ({
        id: p.id,
        name: p.name,
        basePrice: p.basePrice,
        inStock: p.stock > 0,
      }));
    },
  });
  const respondToCustomer = tool({
    description: 'پاسخ نهایی به مشتری را اعلام می‌کند',
    inputSchema: z.object({
      text: z.string(),
      relevantProductIds: z.array(z.string()),
    }),
  });

  const result = await generateText({
    model: client,
    tools: {
      get_product_details: getProductDetails,
      search_products: searchProductsTool,
      respond_to_customer: respondToCustomer,
    },
    stopWhen: stepCountIs(4),
    system: buildAgentSystemPrompt(
      STORE.category,
      candidates.map((p) => p.id),
      customerMessage,
      skipGreeting,
    ),
    prompt: `سوال مشتری: ${customerMessage}\n\nواقعیت‌ها:\n${buildFacts(candidates)}`,
    temperature: 0.3,
  });

  const finalCall = result.toolCalls.find(
    (c) => c.toolName === 'respond_to_customer',
  ) as { input: { text: string; relevantProductIds: string[] } } | undefined;
  if (!finalCall) {
    throw new Error('Agent did not call respond_to_customer within step limit');
  }
  const { text, relevantProductIds } = finalCall.input;
  const matchedProductNames = PRODUCTS.filter((p) =>
    relevantProductIds.includes(p.id),
  ).map((p) => p.name);
  return {
    branch: relevantProductIds.length === 0 ? 'CLARIFY' : 'ANSWER',
    matchedProductNames,
    replyText: text.trim(),
  };
}

function checkProductMatch(
  matchedProductNames: string[],
  expected: ExpectedProductMatch,
): boolean {
  const hasReact = matchedProductNames.some((n) => n.includes('react'));
  const hasPython = matchedProductNames.some((n) => n.includes('پایتون'));
  switch (expected) {
    case 'react':
      return hasReact && !hasPython;
    case 'python':
      return hasPython && !hasReact;
    case 'either':
      return hasReact || hasPython;
    case 'none':
      return matchedProductNames.length === 0;
  }
}

const relevanceSchema = z.object({
  text: z.string(),
  relevantProductIds: z.array(z.string()),
});

type Branch = 'CLARIFY' | 'BRIDGE' | 'NORMAL';

type ExpectedProductMatch = 'react' | 'python' | 'either' | 'none';

interface TestCase {
  id: string;
  message: string;
  notes: string;
  expectSpam?: false; // اگر true نباشد یعنی این پیام هرگز نباید OFF_TOPIC_OR_SPAM بگیرد
  expectedProductMatch?: ExpectedProductMatch;
  // docs/PRD-sales-agent-response-strategy-ab.md فاز ۱ — کدام شاخه‌ی جدول تصمیم Track A باید
  // فعال شود؛ undefined یعنی انتظار سخت‌گیرانه‌ای نداریم (exploratory)
  expectedBranch?: Branch;
}

const TEST_CASES: TestCase[] = [
  {
    id: 't1',
    message: 'میخوام برم فرانت اند دولوپر بشم',
    notes:
      'نمونه‌ی ریشه‌ای باگ اصلی سند — implicit+relevant+ready، باید بریج بزند',
    expectedProductMatch: 'react',
    expectedBranch: 'BRIDGE',
  },
  {
    id: 't2',
    message: 'میخوام برنامه نویس فرانت اند بشم',
    notes: 'عین پیام واقعی که کاربر زنده تست کرد',
    expectedProductMatch: 'react',
    expectedBranch: 'BRIDGE',
  },
  {
    id: 't3',
    message: 'یه دوره React میخوام',
    notes:
      'درخواست صریح — باید همیشه کار کرده باشد؛ needType=EXPLICIT پس بریج نمی‌زند',
    expectedProductMatch: 'react',
    expectedBranch: 'NORMAL',
  },
  {
    id: 't4',
    message: 'میخوام پایتون یاد بگیرم',
    notes: 'درخواست صریح پایتون — needType=EXPLICIT پس بریج نمی‌زند',
    expectedProductMatch: 'python',
    expectedBranch: 'NORMAL',
  },
  {
    id: 't5',
    message: 'میخوام وارد دنیای هوش مصنوعی بشم',
    notes:
      'هدف ضمنی که فقط در description پایتون صریح اومده («هوش مصنوعی») — تست عمقی‌تر از صرفاً اسم محصول',
    expectedProductMatch: 'python',
    expectedBranch: 'BRIDGE',
  },
  {
    id: 't6',
    message: 'میخوام برنامه‌نویس بشم ولی نمیدونم از کجا شروع کنم',
    notes:
      'هدف مبهم بین دو دوره — باید سوال روشن‌کننده بپرسد، نه حدس کورکورانه (هدف اصلی فاز ۱)',
    expectedBranch: 'CLARIFY',
  },
  {
    id: 't7',
    message: 'میخوام بک‌اند دولوپر بشم',
    notes:
      'پایتون هم بک‌اند هم هست — تست اینکه مدل React رو اشتباهی پیشنهاد نده',
    expectedProductMatch: 'python',
    expectedBranch: 'BRIDGE',
  },
  {
    id: 't8',
    message: 'میخوام مهاجرت کنم',
    notes:
      'کنترل منفی — کاملاً نامرتبط، نباید BROWSE/پیشنهاد بدهد و نباید اسپم باشد',
    expectedProductMatch: 'none',
    expectedBranch: 'NORMAL',
  },
  {
    id: 't9',
    message: 'امروز حوصله ندارم',
    notes: 'نیاز خریدی ندارد، نباید پیشنهاد اجباری بدهد',
    expectedProductMatch: 'none',
    expectedBranch: 'NORMAL',
  },
  {
    id: 't10',
    message: 'تخفیف ویژه امروز فالو کن برنده شو لینک بیو',
    notes: 'کنترل مثبت اسپم — این باید واقعاً OFF_TOPIC_OR_SPAM بگیرد',
    expectedProductMatch: 'none',
    expectedBranch: 'NORMAL',
  },
  {
    id: 't11',
    message: 'دوره‌ی react چند ساعته؟',
    notes:
      'سوال مشخص درباره‌ی react — باید facts را صادقانه جواب بدهد (توضیحات مدت‌زمان ندارد)',
    expectedProductMatch: 'react',
    expectedBranch: 'NORMAL',
  },
  {
    id: 't12',
    message: 'می‌خوام سایت درست کنم',
    notes:
      'هدف عمومی که به هر دو (فرانت/بک) می‌خورد — exploratory، بدون انتظار سخت‌گیرانه روی branch',
    expectedProductMatch: 'either',
  },
];

const FALSE_POSITIVE_RISK_IDS = new Set([
  't1',
  't2',
  't3',
  't4',
  't5',
  't6',
  't7',
  't8',
  't9',
  't12',
]); // همه جز t10 (اسپم واقعی) — اگر هرکدوم اینا OFF_TOPIC_OR_SPAM بگیرن یعنی رگرسیون

async function main() {
  const variantKey = process.argv[2] ?? DEFAULT_VARIANT_KEY;
  const model = resolveModel(variantKey);
  const aiProvider = new AiProviderService(fakeConfig);
  const client = aiProvider.buildClient(undefined, {
    supportsStructuredOutputs: true,
  })(model);

  const storeContextSummary = [
    STORE.category && `این فروشگاه در حوزه‌ی «${STORE.category}» فعالیت می‌کند`,
    STORE.brandIntro,
  ]
    .filter(Boolean)
    .join('. ');

  console.log(
    `\n== تست end-to-end واقعی (فروشگاه نهایت یادگیری) — مدل: ${variantKey} (${model}) ==`,
  );
  console.log(`زمینه‌ی فروشگاه ارسالی: "${storeContextSummary || 'نامشخص'}"\n`);

  type Row = {
    id: string;
    message: string;
    notes: string;
    intent?: string;
    needType?: string;
    storeRelevance?: string;
    pitchReadiness?: string;
    buyerNeeds?: string[];
    productQuery?: string | null;
    matchedProductNames: string[];
    clarifyFallbackBug: boolean;
    spamFalsePositive: boolean;
    expectedProductMatch?: ExpectedProductMatch;
    productMatchOk?: boolean;
    branch: Branch;
    expectedBranch?: Branch;
    branchOk?: boolean;
    replyText?: string;
    error?: string;
    // Track B (agent) — docs/PRD-sales-agent-response-strategy-ab.md بخش ۷، همون کاندیدها/
    // طبقه‌بندی Track A را به اشتراک می‌گذارد، فقط شاخه‌ی پایانی (doBrowse) را agent تصمیم می‌گیرد
    branchB?: BranchB;
    matchedProductNamesB?: string[];
    productMatchOkB?: boolean;
    branchOkB?: boolean;
    replyTextB?: string;
    errorB?: string;
  };
  const rows: Row[] = [];

  for (const tc of TEST_CASES) {
    try {
      const { object: parsed } = await generateObject({
        model: client,
        schema: intentClassificationSchema,
        system: buildIntentClassificationPrompt(
          'BROWSING',
          storeContextSummary,
        ),
        prompt: tc.message,
      });

      let matchedProductNames: string[] = [];
      let clarifyFallbackBug = false;
      let branch: Branch = 'NORMAL';
      let replyText: string | undefined;
      let branchB: BranchB | undefined;
      let matchedProductNamesB: string[] | undefined;
      let replyTextB: string | undefined;
      let errorB: string | undefined;

      if (parsed.intent === 'BROWSE') {
        const query = parsed.productQuery?.trim();
        const candidates = query
          ? PRODUCTS.filter((p) =>
              p.name.toLowerCase().includes(query.toLowerCase()),
            )
          : PRODUCTS;

        if (candidates.length === 0) {
          clarifyFallbackBug = parsed.storeRelevance !== 'NOT_RELEVANT';
        } else if (
          parsed.needType &&
          parsed.needType !== 'NONE' &&
          parsed.pitchReadiness === 'NEEDS_CLARIFICATION'
        ) {
          // docs/PRD-sales-agent-response-strategy-ab.md بخش ۱ — askClarifyingQuestion: هیچ
          // محصولی نشان داده نمی‌شود، فقط یک سوال روشن‌کننده
          branch = 'CLARIFY';
          const needSummary = parsed.implicitNeedSummary ?? tc.message;
          const { text } = await generateText({
            model: client,
            system: buildAskClarifyingQuestionSystemPrompt(
              STORE.category,
              needSummary,
              false,
            ),
            prompt: buildFacts(candidates),
          });
          replyText = text.trim();
        } else {
          const bridgeNeedSummary =
            parsed.needType === 'IMPLICIT' &&
            parsed.storeRelevance === 'RELEVANT' &&
            parsed.pitchReadiness === 'READY'
              ? (parsed.implicitNeedSummary ?? null)
              : null;
          branch = bridgeNeedSummary ? 'BRIDGE' : 'NORMAL';

          if (candidates.length === 1) {
            matchedProductNames = [candidates[0].name];
            if (bridgeNeedSummary) {
              const { text } = await generateText({
                model: client,
                system: buildCaptionSystemPrompt(
                  STORE.category,
                  tc.message,
                  false,
                  bridgeNeedSummary,
                ),
                prompt: `سوال مشتری: ${tc.message}\n\nواقعیت‌ها:\n${buildFacts(candidates)}`,
              });
              replyText = text.trim();
            }
          } else {
            const facts = buildFacts(candidates);
            const { object: rel } = await generateObject({
              model: client,
              schema: relevanceSchema,
              system: buildRelevanceSystemPrompt(
                STORE.category,
                candidates.map((p) => p.id),
                tc.message,
                false,
                bridgeNeedSummary,
              ),
              prompt: `سوال مشتری: ${tc.message}\n\nواقعیت‌ها:\n${facts}`,
            });
            const ids =
              rel.relevantProductIds.length > 0
                ? rel.relevantProductIds
                : candidates.map((p) => p.id);
            matchedProductNames = candidates
              .filter((p) => ids.includes(p.id))
              .map((p) => p.name);
            replyText = rel.text;
          }
        }

        // Track B — همون کاندیدها، همون طبقه‌بندی بالا، فقط تصمیم نهایی (doBrowse) را به‌جای
        // جدول Track A، یک agent با ابزار می‌گیرد. خطای مستقل Track B کل ردیف را خراب نمی‌کند.
        // فقط وقتی حداقل یک کاندید واقعی هست اجرا می‌شود (هم‌ارز شرط candidates.length===0 بالا)
        if (candidates.length > 0) {
          try {
            const b = await runTrackB(client, candidates, tc.message, false);
            branchB = b.branch;
            matchedProductNamesB = b.matchedProductNames;
            replyTextB = b.replyText;
          } catch (err) {
            errorB = err instanceof Error ? err.message : 'خطای نامشخص';
          }
        }
      }

      const spamFalsePositive =
        FALSE_POSITIVE_RISK_IDS.has(tc.id) &&
        (parsed.buyerNeeds ?? []).includes('OFF_TOPIC_OR_SPAM');

      // وقتی CLARIFY فعال شد، هیچ محصولی عمداً نشان داده نمی‌شود — پس تطابق محصولِ قدیمی اینجا
      // معنا ندارد، فقط expectedBranch سنجیده می‌شود
      const productMatchOk =
        tc.expectedProductMatch && branch !== 'CLARIFY'
          ? checkProductMatch(matchedProductNames, tc.expectedProductMatch)
          : undefined;

      const branchOk = tc.expectedBranch
        ? branch === tc.expectedBranch
        : undefined;

      // Track B: همون expectedProductMatch Track A برای محصول معتبر است (هر دو مسیر روی همون
      // کاتالوگ تصمیم می‌گیرند)؛ expectedBranch اما سه‌حالته‌ی Track A است، برای B به دو‌حالته
      // نگاشت می‌شود: CLARIFY یعنی CLARIFY، BRIDGE/NORMAL یعنی «باید پاسخ/محصول بدهد» (ANSWER)
      const expectedBranchB: BranchB | undefined = !tc.expectedBranch
        ? undefined
        : tc.expectedBranch === 'CLARIFY'
          ? 'CLARIFY'
          : 'ANSWER';
      const productMatchOkB =
        tc.expectedProductMatch && branchB && branchB !== 'CLARIFY'
          ? checkProductMatch(
              matchedProductNamesB ?? [],
              tc.expectedProductMatch,
            )
          : undefined;
      const branchOkB =
        expectedBranchB && branchB ? branchB === expectedBranchB : undefined;

      rows.push({
        id: tc.id,
        message: tc.message,
        notes: tc.notes,
        intent: parsed.intent,
        needType: parsed.needType,
        storeRelevance: parsed.storeRelevance,
        pitchReadiness: parsed.pitchReadiness,
        buyerNeeds: parsed.buyerNeeds ?? [],
        productQuery: parsed.productQuery,
        matchedProductNames,
        clarifyFallbackBug,
        spamFalsePositive,
        expectedProductMatch: tc.expectedProductMatch,
        productMatchOk,
        branch,
        expectedBranch: tc.expectedBranch,
        branchOk,
        replyText,
        branchB,
        matchedProductNamesB,
        productMatchOkB,
        branchOkB,
        replyTextB,
        errorB,
      });
    } catch (err) {
      rows.push({
        id: tc.id,
        message: tc.message,
        notes: tc.notes,
        matchedProductNames: [],
        clarifyFallbackBug: false,
        spamFalsePositive: false,
        expectedProductMatch: tc.expectedProductMatch,
        branch: 'NORMAL',
        expectedBranch: tc.expectedBranch,
        error: err instanceof Error ? err.message : 'خطای نامشخص',
      });
    }
  }

  for (const r of rows) {
    const mark = r.error
      ? '💥'
      : r.spamFalsePositive || r.clarifyFallbackBug
        ? '🚨'
        : r.productMatchOk === false || r.branchOk === false
          ? '❌'
          : '✅';
    console.log(`${mark} [${r.id}] "${r.message}" — ${r.notes}`);
    if (r.error) {
      console.log(`   خطا: ${r.error}`);
      continue;
    }
    console.log(
      `   intent=${r.intent} needType=${r.needType} storeRelevance=${r.storeRelevance} pitchReadiness=${r.pitchReadiness}`,
    );
    console.log(
      `   buyerNeeds=${r.buyerNeeds?.join(',') || '—'}  productQuery=${r.productQuery ?? '—'}`,
    );
    console.log(
      `   branch=${r.branch}${r.expectedBranch ? ` (انتظار: ${r.expectedBranch}${r.branchOk ? ' ✓' : ' ✗'})` : ''}`,
    );
    console.log(
      `   محصول(های) نهایی نمایش‌داده‌شده: ${r.matchedProductNames.join(' + ') || '—'}${
        r.expectedProductMatch ? `  (انتظار: ${r.expectedProductMatch})` : ''
      }`,
    );
    if (r.replyText) console.log(`   متن تولیدشده (Track A): «${r.replyText}»`);
    if (r.spamFalsePositive)
      console.log('   🚨 FALSE-POSITIVE-SPAM — این دقیقاً همون باگ ریشه‌ایه');
    if (r.clarifyFallbackBug)
      console.log(
        '   🚨 CLARIFY-FALLBACK-BUG — productQuery هیچ محصولی رو match نکرد با وجود BROWSE/RELEVANT',
      );
    if (r.errorB) {
      console.log(`   💥 Track B خطا: ${r.errorB}`);
    } else if (r.branchB) {
      const markB =
        r.productMatchOkB === false || r.branchOkB === false ? '❌' : '✅';
      console.log(
        `   ${markB} Track B: branch=${r.branchB}${
          r.branchOkB !== undefined ? (r.branchOkB ? ' ✓' : ' ✗') : ''
        } — محصول: ${r.matchedProductNamesB?.join(' + ') || '—'}`,
      );
      if (r.replyTextB)
        console.log(`      متن تولیدشده (Track B): «${r.replyTextB}»`);
    }
  }

  const total = rows.length;
  const errors = rows.filter((r) => r.error).length;
  const spamFP = rows.filter((r) => r.spamFalsePositive).length;
  const clarifyBugs = rows.filter((r) => r.clarifyFallbackBug).length;
  // branch===CLARIFY یعنی عمداً هیچ محصولی نشان داده نشده (productMatchOk هم عمداً undefined
  // می‌ماند) — این ردیف‌ها باید از مخرج کسر شوند، نه این‌که به‌اشتباه «شکست تطابق محصول» حساب شوند
  const withExpectation = rows.filter(
    (r) => r.expectedProductMatch && !r.error && r.productMatchOk !== undefined,
  );
  const productMatchPassed = withExpectation.filter(
    (r) => r.productMatchOk,
  ).length;
  const withBranchExpectation = rows.filter(
    (r) => r.expectedBranch && !r.error,
  );
  const branchPassed = withBranchExpectation.filter((r) => r.branchOk).length;

  console.log('\n== خلاصه ==');
  console.log(`کل موارد: ${total} (${errors} خطای فنی)`);
  console.log(`False-positive spam: ${spamFP} — باید ۰ باشد`);
  console.log(
    `Clarify-fallback bug (productQuery اشتباه): ${clarifyBugs} — باید ۰ باشد`,
  );
  console.log(
    `تطابق محصول صحیح: ${productMatchPassed}/${withExpectation.length} (${
      withExpectation.length
        ? Math.round((productMatchPassed / withExpectation.length) * 100)
        : 0
    }%)`,
  );
  console.log(
    `تطابق branch صحیح (Track A — CLARIFY/BRIDGE/NORMAL): ${branchPassed}/${withBranchExpectation.length} (${
      withBranchExpectation.length
        ? Math.round((branchPassed / withBranchExpectation.length) * 100)
        : 0
    }%)`,
  );

  // Track B — docs/PRD-sales-agent-response-strategy-ab.md بخش ۷، همون معیارها برای مقایسه‌ی
  // مستقیم با Track A بالا
  const errorsB = rows.filter((r) => r.errorB).length;
  const withExpectationB = rows.filter(
    (r) =>
      r.expectedProductMatch && !r.errorB && r.productMatchOkB !== undefined,
  );
  const productMatchPassedB = withExpectationB.filter(
    (r) => r.productMatchOkB,
  ).length;
  const withBranchExpectationB = rows.filter(
    (r) => r.expectedBranch && !r.errorB && r.branchOkB !== undefined,
  );
  const branchPassedB = withBranchExpectationB.filter(
    (r) => r.branchOkB,
  ).length;

  console.log('\n== خلاصه Track B (agent) — برای مقایسه‌ی مستقیم با بالا ==');
  console.log(`خطای فنی (مثلاً به respond_to_customer نرسید): ${errorsB}`);
  console.log(
    `تطابق محصول صحیح: ${productMatchPassedB}/${withExpectationB.length} (${
      withExpectationB.length
        ? Math.round((productMatchPassedB / withExpectationB.length) * 100)
        : 0
    }%)`,
  );
  console.log(
    `تطابق branch صحیح (CLARIFY/ANSWER): ${branchPassedB}/${withBranchExpectationB.length} (${
      withBranchExpectationB.length
        ? Math.round((branchPassedB / withBranchExpectationB.length) * 100)
        : 0
    }%)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('اجرای تست شکست خورد:', err);
    process.exit(1);
  });
