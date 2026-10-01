// docs/PRD-sales-agent-implicit-need-detection.md بخش ۵ (فاز ۰) — اجرای مستقل (بدون بوت Nest
// کامل/Docker) تا baseline واقعیِ سیستم فعلی (schema/prompt دست‌نخورده) قبل از هر تغییری ثبت
// شود. مثل بقیه‌ی scripts/manual/*.ts، مستقیم از src ایمپورت می‌کند، نه از طریق DI.
//
// اجرا: npx ts-node --transpile-only scripts/manual/run-implicit-need-baseline.ts [variantKey]
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

// اول .env ریشه‌ی مونوریپو (LIARA_*‌ها همین‌جا ست شده‌اند، تایید شده با چک دستی) — سپس
// .env.localtest خود بک‌اند بدون override، فقط برای پر کردن جاخالی‌ها
loadEnv({ path: resolve(__dirname, '../../../.env') });
loadEnv({ path: resolve(__dirname, '../../.env.localtest'), override: false });

import type { ConfigService } from '@nestjs/config';
import { generateObject } from 'ai';
import { AiProviderService } from '../../src/common/services/ai-provider.service';
import {
  resolveModel,
  DEFAULT_VARIANT_KEY,
} from '../../src/modules/sales-agent/model-variants';
import {
  buildIntentClassificationPrompt,
  intentClassificationSchema,
} from '../../src/modules/sales-agent/intent-classification.schema';
import {
  IMPLICIT_NEED_GOLDEN_CASES,
  type ImplicitNeedCategory,
} from '../../src/modules/sales-agent/intent-implicit-need-golden-cases';

// فقط .get(key) لازم است — کل AiProviderService همین یک متد از ConfigService استفاده می‌کند
const fakeConfig = {
  get: (key: string) => process.env[key],
} as unknown as ConfigService;

// دسته‌هایی که پیام یک «هدف/گفتگوی شخصی واقعی» است، نه اسپم — اگر مدل اینجا
// OFF_TOPIC_OR_SPAM بزند، دقیقاً نمونه‌ی باگ ریشه‌ای این سند است (نه یک false-negative ساده)
const FALSE_POSITIVE_RISK_CATEGORIES: ImplicitNeedCategory[] = [
  'RELEVANT_IMPLICIT_GOAL',
  'IRRELEVANT_GOAL',
  'NON_PURCHASE_MESSAGE',
  'AMBIGUOUS_GOAL',
];

async function main() {
  const variantKey = process.argv[2] ?? DEFAULT_VARIANT_KEY;
  const model = resolveModel(variantKey);
  const aiProvider = new AiProviderService(fakeConfig);

  console.log(
    `\n== baseline فاز ۰ — فروشگاه فرضی، مدل: ${variantKey} (${model}) ==\n`,
  );

  type Row = {
    id: string;
    category: ImplicitNeedCategory;
    message: string;
    expectedIntent: string;
    actualIntent?: string;
    actualBuyerNeeds: string[];
    unmatchedBuyerNeed?: string;
    passed: boolean;
    falsePositiveSpam: boolean;
    notFullyMeasurableYet?: boolean;
    error?: string;
  };
  const rows: Row[] = [];

  for (const goldenCase of IMPLICIT_NEED_GOLDEN_CASES) {
    try {
      const { object } = await generateObject({
        model: aiProvider.buildClient(undefined, {
          supportsStructuredOutputs: true,
        })(model),
        schema: intentClassificationSchema,
        system: buildIntentClassificationPrompt(goldenCase.state ?? 'BROWSING'),
        prompt: goldenCase.message,
      });
      const actualBuyerNeeds = object.buyerNeeds ?? [];
      const buyerNeedsOk =
        !goldenCase.expectedBuyerNeeds?.length ||
        goldenCase.expectedBuyerNeeds.every((t) =>
          actualBuyerNeeds.includes(t),
        );
      const falsePositiveSpam =
        FALSE_POSITIVE_RISK_CATEGORIES.includes(goldenCase.category) &&
        actualBuyerNeeds.includes('OFF_TOPIC_OR_SPAM');
      rows.push({
        id: goldenCase.id,
        category: goldenCase.category,
        message: goldenCase.message,
        expectedIntent: goldenCase.expectedIntent,
        actualIntent: object.intent,
        actualBuyerNeeds,
        unmatchedBuyerNeed: object.unmatchedBuyerNeed ?? undefined,
        passed: object.intent === goldenCase.expectedIntent && buyerNeedsOk,
        falsePositiveSpam,
        notFullyMeasurableYet: goldenCase.notFullyMeasurableYet,
      });
    } catch (err) {
      rows.push({
        id: goldenCase.id,
        category: goldenCase.category,
        message: goldenCase.message,
        expectedIntent: goldenCase.expectedIntent,
        actualBuyerNeeds: [],
        passed: false,
        falsePositiveSpam: false,
        notFullyMeasurableYet: goldenCase.notFullyMeasurableYet,
        error: err instanceof Error ? err.message : 'خطای نامشخص',
      });
    }
  }

  for (const r of rows) {
    const mark = r.error ? '💥' : r.passed ? '✅' : '❌';
    const spamFlag = r.falsePositiveSpam ? '  ⚠️ FALSE-POSITIVE-SPAM' : '';
    const notMeasurable = r.notFullyMeasurableYet ? '  (نیازمند فاز بعد)' : '';
    console.log(
      `${mark} [${r.category}] ${r.id} — "${r.message}"\n` +
        `   expected=${r.expectedIntent}  actual=${r.actualIntent ?? r.error}  buyerNeeds=${r.actualBuyerNeeds.join(',') || '—'}${r.unmatchedBuyerNeed ? `  unmatched=${r.unmatchedBuyerNeed}` : ''}${spamFlag}${notMeasurable}`,
    );
  }

  const total = rows.length;
  const passed = rows.filter((r) => r.passed).length;
  const falsePositives = rows.filter((r) => r.falsePositiveSpam).length;
  const measurable = rows.filter((r) => !r.notFullyMeasurableYet);
  const measurablePassed = measurable.filter((r) => r.passed).length;

  console.log('\n== خلاصه ==');
  console.log(`کل موارد: ${total} — passed: ${passed}/${total}`);
  console.log(
    `موارد قابل‌سنجش کامل با schema فعلی: ${measurable.length} — passed: ${measurablePassed}/${measurable.length}`,
  );
  console.log(
    `False-positive (OFF_TOPIC_OR_SPAM روی پیام غیراسپم): ${falsePositives} مورد — این مهم‌ترین عدد طبق بخش ۸ PRD است`,
  );

  const byCategory = new Map<string, { total: number; passed: number }>();
  for (const r of rows) {
    const c = byCategory.get(r.category) ?? { total: 0, passed: 0 };
    c.total++;
    if (r.passed) c.passed++;
    byCategory.set(r.category, c);
  }
  console.log('\nبه‌تفکیک دسته:');
  for (const [cat, { total: t, passed: p }] of byCategory) {
    console.log(`  ${cat}: ${p}/${t}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('اجرای baseline شکست خورد:', err);
    process.exit(1);
  });
