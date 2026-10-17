import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { generateObject } from 'ai';
import type { UserModelMessage } from 'ai';
import { z } from 'zod';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import { ProductEventService } from '../../common/analytics/product-event.service';
import { parseFaAmounts } from '../../common/utils/fa-amounts.util';
import { fa } from '../../i18n/fa';
import { StoreService } from './store.service';
import { VARIANT_PRONE_CATEGORIES } from './store-kb.service';
import { defaultModel } from '../sales-agent/model-variants';
import { clampProductSpecs } from './product-specs.types';

// docs/PRD-seller-panel-simplification.md §4.4 — «عکس + یک جمله ← فیلدها». هیچ‌چیز نمی‌نویسد؛
// فرانت نتیجه را روی فیلدهای خالی اعمال می‌کند. برای فروشنده رایگان است (مسیر فعال‌سازی).
export const AI_FILL_DAILY_LIMIT = 150;
// timeout برای هر مدل جداست (نه مشترک) تا شکست مدل اول به fallback فرصت کامل بدهد
const AI_FILL_TIMEOUT_MS = 45_000;
const AI_FILL_MAX_ATTEMPTS = 3;
// fallback سریع‌ها؛ luna-pro (reasoning) با عکس کند است و در بازه‌ی باقی‌مانده timeout می‌خورد
const AI_FILL_FALLBACKS = [
  'openai/gpt-6-luna',
  'google/gemini-3.8-flash',
];
const MAX_IMAGES = 2;
const MAX_IMAGE_SIDE = 1024;
const UNTRACKED_RE = /همیشه\s*(داریم|موجوده|موجود)|سفارشی|تولیدی/;

export type AiFillMissing = 'name' | 'price' | 'stock';

export interface AiFillResult {
  name?: string;
  basePrice?: number;
  stock?: number;
  trackStock?: boolean;
  description?: string;
  specs?: { label: string; value: string }[];
  weightGrams?: number;
  purityKarat?: number;
  variantOptions?: { name: string; values: { value: string; stock?: number }[] }[];
  missing: AiFillMissing[];
  assumptions: string[];
}

// فیلدها .nullable() هستند نه .optional() — با strict structured outputs در OpenAI فیلد
// optional خطای «Missing ...» می‌دهد (همان تجربه‌ی extractProductCandidatesFromText)
export const aiFillSchema = z.object({
  name: z.string().nullable(),
  description: z.string().nullable(),
  stock: z.number().nullable(),
  alwaysInStock: z.boolean().nullable(),
  weightGrams: z.number().nullable(),
  purityKarat: z.number().nullable(),
  specs: z.array(z.object({ label: z.string(), value: z.string() })).max(8),
  variantOptions: z
    .array(
      z.object({
        name: z.string(),
        values: z
          .array(z.object({ value: z.string(), stock: z.number().nullable() }))
          .max(30),
      }),
    )
    .max(2),
  assumptions: z.array(z.string()),
});
export type AiFillModelOutput = z.infer<typeof aiFillSchema>;

// قیمت همیشه از پارسر مشترک (R1.4) می‌آید، نه عدد مدل. اگر چند مبلغ در متن بود اولین مبلغ
// برداشته می‌شود؛ فروشنده در فرم می‌بیند و اصلاح می‌کند (و زیر فیلد، مبلغ به حروف نشان داده می‌شود).
export function normalizeAiFill(
  raw: AiFillModelOutput,
  text: string,
  ctx: { pricingModel: 'FIXED' | 'WEIGHT_BASED_FORMULA' },
): AiFillResult {
  const amounts = parseFaAmounts(text);
  const basePrice =
    ctx.pricingModel === 'FIXED' && amounts.length > 0 ? amounts[0] : undefined;
  const untracked = raw.alwaysInStock === true || UNTRACKED_RE.test(text);
  const variantOptions = raw.variantOptions
    .map((o) => ({
      name: o.name.trim().slice(0, 30),
      values: o.values
        .map((v) => ({
          value: v.value.trim().slice(0, 30),
          ...(v.stock != null && !untracked
            ? { stock: Math.max(0, Math.round(v.stock)) }
            : {}),
        }))
        .filter((v) => v.value),
    }))
    .filter((o) => o.name && o.values.length > 0);
  const name = raw.name?.trim().slice(0, 60) || undefined;
  const specs = clampProductSpecs(raw.specs);
  const result: AiFillResult = {
    ...(name ? { name } : {}),
    ...(basePrice !== undefined ? { basePrice } : {}),
    ...(untracked ? { trackStock: false } : {}),
    ...(!untracked && raw.stock != null && variantOptions.length === 0
      ? { stock: Math.max(0, Math.round(raw.stock)) }
      : {}),
    ...(raw.description?.trim()
      ? { description: raw.description.trim().slice(0, 1200) }
      : {}),
    ...(specs ? { specs } : {}),
    ...(raw.weightGrams != null && raw.weightGrams > 0
      ? { weightGrams: raw.weightGrams }
      : {}),
    ...(raw.purityKarat != null && raw.purityKarat > 0
      ? { purityKarat: Math.round(raw.purityKarat) }
      : {}),
    ...(variantOptions.length ? { variantOptions } : {}),
    missing: [],
    assumptions: raw.assumptions
      .map((a) => a.trim())
      .filter(Boolean)
      .slice(0, 5),
  };
  if (!result.name) result.missing.push('name');
  if (ctx.pricingModel === 'FIXED' && result.basePrice === undefined)
    result.missing.push('price');
  if (!untracked && result.stock === undefined && !result.variantOptions)
    result.missing.push('stock');
  return result;
}

@Injectable()
export class ProductAiFillService {
  private readonly logger = new Logger(ProductAiFillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly aiProvider: AiProviderService,
    private readonly storeService: StoreService,
    private readonly productEvents: ProductEventService,
  ) {}

  private async loadImages(keys: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const key of keys.slice(0, MAX_IMAGES)) {
      try {
        const buf = await this.storage.downloadImage(key);
        const small = await sharp(buf)
          .rotate()
          .resize({
            width: MAX_IMAGE_SIDE,
            height: MAX_IMAGE_SIDE,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: 80 })
          .toBuffer();
        out.push(`data:image/jpeg;base64,${small.toString('base64')}`);
      } catch (err) {
        this.logger.warn(
          `ai-fill image skipped (${key}): ${(err as Error).message}`,
        );
      }
    }
    return out;
  }

  async fill(
    sellerId: string,
    storeId: string,
    productId: string,
    rawText?: string,
  ): Promise<AiFillResult> {
    const store = await this.storeService.getOwned(sellerId, storeId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        storeId: true,
        status: true,
        images: true,
        name: true,
        pricingModel: true,
      },
    });
    if (
      !product ||
      product.storeId !== storeId ||
      (product.status !== 'DRAFT' && product.status !== 'ACTIVE')
    ) {
      throw new NotFoundException(fa.store.productNotFound);
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (
      (await this.productEvents.countSince('product_ai_draft', storeId, since)) >=
      AI_FILL_DAILY_LIMIT
    ) {
      throw new HttpException(
        fa.store.aiFillRateLimited,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const text = (rawText ?? '').trim().slice(0, 2000);
    const images = await this.loadImages(product.images);
    const started = Date.now();
    const log = (ok: boolean, model: string | null) =>
      this.productEvents.log(
        'product_ai_draft',
        { storeId, userId: sellerId },
        {
          productId,
          hasImage: images.length > 0,
          hasText: text.length > 0,
          ok,
          ms: Date.now() - started,
          model,
        },
      );

    const category = store.category ?? 'نامشخص';
    const variantHint =
      store.category && VARIANT_PRONE_CATEGORIES.has(store.category)
        ? `\nمحصولات دسته‌ی «${store.category}» معمولاً سایز/رنگ/مدل دارند؛ اگر متن یا عکس اشاره‌ای دارد variantOptions را پر کن.`
        : '';
    const instruction = `تو دستیار یک فروشنده‌ی ایرانی هستی. از روی عکس(ها) و جمله‌ی فروشنده، فیلدهای یک محصول را پیشنهاد بده.
دسته‌ی فروشگاه: ${category}.${variantHint}
قواعد:
- name: فارسی، حداکثر ۶۰ کاراکتر؛ اگر مطمئن نیستی null.
- description: ۲ تا ۴ جمله‌ی کوتاه، بدون ایموجی، فقط ادعاهایی که از عکس یا متن برمی‌آید؛ وگرنه null.
- قیمت را هرگز نمی‌نویسی و حدس نمی‌زنی (سیستم خودش از متن می‌خواند).
- stock فقط اگر تعداد صریح گفته شده؛ اگر گفته «همیشه داریم/سفارشی/تولیدی» alwaysInStock را true بگذار.
- variantOptions فقط اگر سایز/رنگ/مدل صریح گفته شده یا در عکس واضح است (حداکثر ۲ نوع)؛ بازه‌ی «۳۸ تا ۴۴» را مقدار به مقدار (زوج‌به‌زوج برای سایز لباس) بنویس.
- اگر وزن/عیار طلا گفته شده («۳ گرم ۱۸ عیار») weightGrams/purityKarat را پر کن.
- هر فرضی که کردی را در assumptions بنویس. هرگز چیزی اختراع نکن.
فقط یک شیء JSON معتبر مطابق schema برگردان.`;
    const content: Exclude<UserModelMessage['content'], string> = [
      ...images.map((image) => ({ type: 'image' as const, image })),
      {
        type: 'text' as const,
        text: `${instruction}\n\nجمله‌ی فروشنده: ${text || '(چیزی نگفته؛ فقط از روی عکس)'}`,
      },
    ];

    const first = defaultModel();
    const models = [
      first,
      ...AI_FILL_FALLBACKS.filter((m) => m !== first),
    ].slice(0, AI_FILL_MAX_ATTEMPTS);
    let lastErr: unknown;
    for (const model of models) {
      const deadline = AbortSignal.timeout(AI_FILL_TIMEOUT_MS);
      try {
        const { object } = await generateObject({
          model: this.aiProvider.buildClient(undefined, {
            supportsStructuredOutputs: true,
          })(model),
          schema: aiFillSchema,
          messages: [{ role: 'user', content }],
          abortSignal: deadline,
        });
        log(true, model);
        return normalizeAiFill(object, text, {
          pricingModel: product.pricingModel,
        });
      } catch (err) {
        lastErr = err;
        this.logger.warn(
          `ai-fill model ${model} failed: ${(err as Error).message}` +
            ((err as { cause?: unknown }).cause
              ? ` | cause=${String((err as { cause?: unknown }).cause).slice(0, 400)}`
              : '') +
            ((err as { text?: string }).text
              ? ` | raw=${(err as { text?: string }).text!.slice(0, 600)}`
              : ''),
        );
      }
    }
    log(false, null);
    this.logger.error(
      `ai-fill failed for product=${productId}: ${(lastErr as Error)?.message}`,
    );
    throw new BadGatewayException(fa.store.aiFillFailed);
  }
}
