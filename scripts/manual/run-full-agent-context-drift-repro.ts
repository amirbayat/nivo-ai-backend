// باگ واقعی زنده (۱۴۰۵/۰۷/۱۹، docs/PRD-sales-agent-tool-calling-architecture.md) — مشتری یک
// فروشگاه غذای حیوانات داشت بین دو غذای سگ مقایسه می‌کرد («کدوم بهتره؟ چه فرقی دارن؟»)، مدل
// ناگهان رفت سراغ دان پرنده. علت: FULL_AGENT هیچ‌وقت ctx.lastShownProducts را نمی‌نوشت، پس تنها
// منبع ساختاریافته‌ی باقی‌مانده «کاتالوگ اولیه» (۵ محصول با جدیدترین createdAt) بود که برای این
// فروشگاه (چون دان پرنده آخر از همه وارد شده بود) همیشه محصولات پرنده را نشان می‌داد — کاملاً
// بی‌ربط به بحث جاری. فیکس: lastShownProducts بعد از هر respond_to_customer به‌روزرسانی می‌شود و
// صریح در پرامپت اولویت داده می‌شود. این اسکریپت دقیقاً همان سناریو را با API واقعی بازتولید و
// فیکس را تایید می‌کند.
//
// اجرا: npx ts-node --transpile-only scripts/manual/run-full-agent-context-drift-repro.ts [variantKey]
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

const fakeConfig = {
  get: (key: string) => process.env[key],
} as unknown as ConfigService;

// عمداً به ترتیب «قدیمی‌ترین اول»: دقیقاً مثل importProducts واقعی که ردیف‌های اکسل را به ترتیب
// می‌سازد — یعنی آخرین عنصر این آرایه «جدیدترین createdAt» است، دقیقاً مثل فروشگاه واقعی که در
// آن غذای پرنده آخر از همه وارد شده بود
const PRODUCTS = [
  {
    id: 'dog-royal-puppy',
    name: 'غذای خشک سگ رویال کنین پاپی نژاد کوچک 3 کیلویی',
    basePrice: 1650000,
    stock: 20,
    description:
      'مخصوص توله‌سگ و نژادهای کوچک، فرمول سالم و اورجینال، واردات مستقیم.',
  },
  {
    id: 'dog-pedigree-puppy',
    name: 'غذای خشک سگ پدیگری توله 3 کیلویی',
    basePrice: 980000,
    stock: 25,
    description: 'گزینه‌ی اقتصادی‌تر برای توله‌سگ، مناسب نژادهای کوچک و متوسط.',
  },
  {
    id: 'cat-whiskas',
    name: 'غذای خشک گربه ویسکاس بالغ طعم ماهی 1.5 کیلویی',
    basePrice: 680000,
    stock: 35,
    description: 'غذای خشک گربه‌ی بالغ، طعم ماهی.',
  },
  // فیلر عمدی: در فروشگاه واقعی که باگ دیده شد، ~۲۰ محصول بود و هر دو غذای سگ کاملاً از
  // پنجره‌ی «۵ تای جدید» بیرون افتاده بودند — با فقط ۶ محصول (نسخه‌ی اول این اسکریپت) یکی از
  // دو غذای سگ هنوز داخل slice(-5) می‌ماند و باگ به‌سختی بازتولید می‌شد؛ این فیلرها دقیقاً همان
  // فاصله‌ی واقعی را شبیه‌سازی می‌کنند تا هر دو گزینه‌ی سگ کاملاً بیرون از دید «کاتالوگ اولیه» باشند
  {
    id: 'cat-royal-kitten',
    name: 'غذای خشک گربه رویال کنین کیتن 2 کیلویی',
    basePrice: 1380000,
    stock: 22,
    description: 'غذای خشک مخصوص بچه‌گربه.',
  },
  {
    id: 'cat-proplan',
    name: 'غذای خشک گربه پروپلن استرلایزد 3 کیلویی',
    basePrice: 1950000,
    stock: 14,
    description: 'غذای خشک گربه‌ی عقیم‌شده.',
  },
  {
    id: 'cat-litter',
    name: 'خاک گربه بنتونیتی بی‌بو 10 لیتری',
    basePrice: 580000,
    stock: 25,
    description: 'خاک گربه‌ی بنتونیتی بدون بو.',
  },
  {
    id: 'bird-sanan',
    name: 'دان طوطی سانان بزرگ (آفریقایی/ماکائو) 1 کیلویی',
    basePrice: 850000,
    stock: 10,
    description: 'دان مخصوص طوطی‌های بزرگ مثل آفریقایی و ماکائو.',
  },
  {
    id: 'bird-budgie',
    name: 'دان مخلوط مرغ عشق و فنچ 900 گرمی',
    basePrice: 195000,
    stock: 32,
    description: 'دان مخلوط مخصوص مرغ عشق و فنچ.',
  },
  {
    id: 'bird-canary',
    name: 'دان مخلوط قناری ویتامینه 900 گرمی',
    basePrice: 220000,
    stock: 30,
    description: 'دان ویتامینه مخصوص قناری.',
  },
];

type Product = (typeof PRODUCTS)[number];
type LastShown = { id: string; name: string };

const DESCRIPTION_FACTS_MAX_CHARS = 700;
function truncateDescriptionForFacts(description: string): string {
  if (description.length <= DESCRIPTION_FACTS_MAX_CHARS) return description;
  return `${description.slice(0, DESCRIPTION_FACTS_MAX_CHARS)}...`;
}

// دقیقاً معادل this.searchProducts(storeId) واقعی: بدون query، ۵ محصول با جدیدترین createdAt
function initialCatalogFacts(products: Product[]): string {
  const mostRecent5 = products.slice(-5);
  return `چند نمونه از محصولات فروشگاه: ${mostRecent5
    .map(
      (p) =>
        `${p.name} (شناسه: ${p.id}, ${p.basePrice} تومان)${
          p.description
            ? ` — توضیحات: ${truncateDescriptionForFacts(p.description)}`
            : ''
        }`,
    )
    .join('، ')}`;
}

function buildSystemPrompt(
  catalogFacts: string,
  transcript: string[],
  lastShownProducts: LastShown[],
  applyFix: boolean,
): string {
  const transcriptText = transcript.slice(-8).join('\n');
  const lastShownLine =
    applyFix && lastShownProducts.length
      ? `\nآخرین محصولاتی که واقعاً در همین مکالمه مطرح/پیشنهاد شده‌اند: ${lastShownProducts.map((p) => p.name).join('، ')}\n`
      : '';
  return `تو دستیار فروش یک فروشگاه در دایرکت اینستاگرام هستی. لحن نوشتار باید گرم و دوستانه باشد.
چند نمونه از محصولات فروشگاه (فقط چند نمونه‌ی کلی، لزوماً ربطی به بحث فعلی ندارند — برای
جست‌وجوی دقیق یا محصولی که اینجا نیست از search_products استفاده کن):
${catalogFacts}
${lastShownLine}${
    transcriptText
      ? `\nتاریخچه‌ی اخیر مکالمه (حتماً برای فهمیدن منظور پیام‌های ناقص/ادامه‌دار مشتری این را در نظر بگیر):\n${transcriptText}\n`
      : ''
  }
قوانین حیاتی:
- هیچ عدد/اسم/شماره‌ای که از ابزارها یا واقعیت‌های بالا نیامده اختراع نکن.
- هرگز تعداد دقیق موجودی انبار را اعلام نکن، فقط «موجود است» یا «فعلاً ناموجود».
- قبل از هر ادعای قیمت/موجودی/جزئیات محصولی که در کاتالوگ اولیه نبود، حتماً search_products یا
  get_product_details را صدا بزن — حدس نزن.${
    applyFix
      ? `
- اگر پیام مشتری مبهم است و اسم هیچ محصولی را نمی‌آورد (مثل «کدوم بهتره؟»، «فرقشون چیه؟»)، منظورش
  تقریباً همیشه «آخرین محصولاتی که مطرح/پیشنهاد شده‌اند» یا تاریخچه‌ی اخیر مکالمه است — نه «چند
  نمونه از محصولات فروشگاه» که فقط یک نمونه‌ی کلی و تصادفی از کل کاتالوگ است.`
      : ''
  }
- در پایان همیشه دقیقاً یک‌بار respond_to_customer را به‌عنوان آخرین قدم صدا بزن؛ relevantProductIds
  باید شامل شناسه‌ی هر محصولی باشد که واقعاً دیده‌ای/معرفی کرده‌ای.`;
}

type TurnResult = {
  text: string;
  relevantProductIds: string[];
  toolsCalled: string[];
  toolFetchedProductIds: Set<string>;
};

async function runTurn(
  client: Parameters<typeof generateText>[0]['model'],
  transcript: string[],
  lastShownProducts: LastShown[],
  customerMessage: string,
  applyFix: boolean,
): Promise<TurnResult> {
  const toolsCalled: string[] = [];
  const seen = new Map<string, Product>();
  // فیکس نهایی (نه فقط «در seen هست یا نه» — چون seen با کاتالوگ اولیه هم seed می‌شد در نسخه‌ی
  // قبلی این اسکریپت و این دقیقاً همان چیزی بود که باگ را بازتولید کرد): فقط محصولاتی که همین
  // نوبت واقعاً با یک تماس ابزار واقعی برگشته‌اند
  const toolFetchedProductIds = new Set<string>();

  const search_products = tool({
    description: 'در کاتالوگ فروشگاه بر اساس یک عبارت جست‌وجو می‌کند',
    inputSchema: z.object({ query: z.string() }),
    execute: ({ query }: { query: string }) => {
      toolsCalled.push('search_products');
      const q = query.toLowerCase();
      const literal = PRODUCTS.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q),
      );
      const results = literal.length > 0 ? literal : PRODUCTS;
      for (const p of results) {
        seen.set(p.id, p);
        toolFetchedProductIds.add(p.id);
      }
      return results.map((p) => ({
        id: p.id,
        name: p.name,
        basePrice: p.basePrice,
        inStock: p.stock > 0,
        description: truncateDescriptionForFacts(p.description),
      }));
    },
  });

  const get_product_details = tool({
    description: 'جزئیات کامل یک محصول را با شناسه‌اش برمی‌گرداند',
    inputSchema: z.object({ productId: z.string() }),
    execute: ({ productId }: { productId: string }) => {
      toolsCalled.push('get_product_details');
      const p = PRODUCTS.find((x) => x.id === productId);
      if (!p) return { error: 'پیدا نشد' };
      seen.set(p.id, p);
      toolFetchedProductIds.add(p.id);
      return {
        id: p.id,
        name: p.name,
        basePrice: p.basePrice,
        inStock: p.stock > 0,
        description: truncateDescriptionForFacts(p.description),
      };
    },
  });

  let finalText = '';
  let finalRelevant: string[] = [];
  const respond_to_customer = tool({
    description: 'پاسخ نهایی به مشتری',
    inputSchema: z.object({
      text: z.string(),
      relevantProductIds: z.array(z.string()),
    }),
    execute: ({
      text,
      relevantProductIds,
    }: {
      text: string;
      relevantProductIds: string[];
    }) => {
      finalText = text;
      finalRelevant = relevantProductIds;
      return { ok: true };
    },
  });

  await generateText({
    model: client,
    tools: { search_products, get_product_details, respond_to_customer },
    stopWhen: stepCountIs(6),
    system: buildSystemPrompt(
      initialCatalogFacts(PRODUCTS),
      transcript,
      lastShownProducts,
      applyFix,
    ),
    prompt: customerMessage,
  });

  return {
    text: finalText,
    relevantProductIds: finalRelevant,
    toolsCalled,
    toolFetchedProductIds,
  };
}

async function runConversation(
  client: Parameters<typeof generateText>[0]['model'],
  label: string,
  messages: string[],
  applyFix: boolean,
) {
  console.log(`\n\n== ${label} (applyFix=${applyFix}) ==`);
  const transcript: string[] = [];
  let lastShownProducts: LastShown[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const r = await runTurn(
      client,
      transcript,
      lastShownProducts,
      message,
      applyFix,
    );
    console.log(`\n--- نوبت ${i + 1} ---`);
    console.log(`📩 مشتری: «${message}»`);
    console.log(`   🔧 ابزارها: ${r.toolsCalled.join(', ') || '—'}`);
    console.log(`   💬 پاسخ: «${r.text}»`);
    const names = r.relevantProductIds.map(
      (id) => PRODUCTS.find((p) => p.id === id)?.name ?? id,
    );
    console.log(`   🛍️  محصولات مرتبط: ${names.join(' + ') || '—'}`);

    transcript.push(`مشتری: ${message}`);
    transcript.push(`فروشنده: ${r.text}`);
    const toolBackedRelevant = r.relevantProductIds.filter((id) =>
      r.toolFetchedProductIds.has(id),
    );
    if (applyFix && toolBackedRelevant.length) {
      lastShownProducts = toolBackedRelevant
        .map((id) => PRODUCTS.find((p) => p.id === id))
        .filter((p): p is Product => !!p)
        .map((p) => ({ id: p.id, name: p.name }));
    }
  }
}

async function main() {
  const variantKey = process.argv[2] ?? DEFAULT_VARIANT_KEY;
  const model = resolveModel(variantKey);
  const aiProvider = new AiProviderService(fakeConfig);
  const client = aiProvider.buildClient(undefined, {
    supportsStructuredOutputs: true,
  })(model);

  console.log(
    `== بازتولید باگ drift موضوع + تایید فیکس — مدل: ${variantKey} (${model}) ==`,
  );

  const CONVERSATION = [
    'سلام، محصولاتتون رو نشون بدید',
    'برای سگم غذا میخوام سگم خیلی کوچولوعه یه غذای سالم و اورجینال',
    'گزینه اقتصادی تر چیه؟',
    'کدوم بهتره؟ چه فرقی دارن؟',
  ];

  const repeats = Number(process.argv[3] ?? '1');
  for (let i = 0; i < repeats; i++) {
    await runConversation(
      client,
      `بدون فیکس (lastShownProducts خاموش) — تکرار ${i + 1}`,
      CONVERSATION,
      false,
    );
  }
  for (let i = 0; i < repeats; i++) {
    await runConversation(
      client,
      `با فیکس (lastShownProducts روشن) — تکرار ${i + 1}`,
      CONVERSATION,
      true,
    );
  }

  console.log('\n\n== چک دستی ==');
  console.log(
    'نوبت ۴ «بدون فیکس» باید (طبق باگ گزارش‌شده) محتمل است برود سراغ محصولات پرنده.',
  );
  console.log('نوبت ۴ «با فیکس» باید روی غذای سگ (رویال‌کنین/پدیگری) بماند.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
