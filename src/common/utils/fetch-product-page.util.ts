import * as cheerio from 'cheerio';

// docs/PRD-seller-knowledge-base.md بخش ۲.۵ — هیچ dependency‌ای برای فچ/پارس HTML در پروژه
// نبود؛ cheerio (بدون jsdom سنگین) برای استخراج متاتگ‌های Open Graph/عنوان/متن قابل‌مشاهده کافی است.
// بسیاری سایت‌ها فچ بدون User-Agent مرورگر را بلاک می‌کنند؛ timeout کوتاه چون این فقط یک
// پیش‌نمایش تعاملی است، نه یک job پس‌زمینه‌ای که بشود منتظرش ماند
const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT =
  'Mozilla/5.0 (compatible; NivoAI-ProductImport/1.0; +https://nivoai.ir)';
const MAX_PAGE_TEXT_CHARS = 8_000;
const MAX_IMAGE_URLS = 3;

export interface FetchedProductPage {
  title: string | null;
  ogDescription: string | null;
  text: string;
  imageUrls: string[];
}

interface JsonLdProduct {
  name?: string;
  description?: string;
  price?: string;
  images: string[];
}

// بسیاری از فروشگاه‌های آنلاین (از جمله دیجی‌کالا) محتوای صفحه‌ی محصول را سمت کلاینت
// (React/Next.js) رندر می‌کنند — یعنی HTML استاتیکی که fetch می‌گیریم اصلاً حاوی نام/توضیح/قیمت
// محصول در body نیست (فقط shell خالی)، و پاک‌سازی بهتر body.text() کمکی نمی‌کند چون متن واقعی
// از ابتدا آنجا نبوده. اما همین سایت‌ها برای سئو/Rich-Results معمولاً داده‌ی ساختاریافته‌ی
// schema.org Product را در یک <script type="application/ld+json"> همان HTML استاتیک می‌گذارند —
// این تنها جای قابل‌اعتماد برای گرفتن نام/توضیح/قیمت واقعی بدون اجرای جاوااسکریپت صفحه است.
function parseJsonLdProduct($: cheerio.CheerioAPI): JsonLdProduct | null {
  const nodes: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // JSON-LD نامعتبر/ناقص روی بعضی سایت‌ها نباید کل فچ را بترکاند
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (item && typeof item === 'object') {
        const graph = (item as Record<string, unknown>)['@graph'];
        if (Array.isArray(graph)) {
          nodes.push(...graph.filter((n): n is Record<string, unknown> => !!n && typeof n === 'object'));
        } else {
          nodes.push(item as Record<string, unknown>);
        }
      }
    }
  });

  const product = nodes.find((node) => {
    const type = node['@type'];
    return type === 'Product' || (Array.isArray(type) && type.includes('Product'));
  });
  if (!product) return null;

  const rawOffers = product.offers;
  const offer = Array.isArray(rawOffers) ? rawOffers[0] : rawOffers;
  const price =
    offer && typeof offer === 'object' && 'price' in offer
      ? String((offer as Record<string, unknown>).price)
      : undefined;

  const rawImage = product.image;
  const images = (Array.isArray(rawImage) ? rawImage : rawImage ? [rawImage] : [])
    .filter((src): src is string => typeof src === 'string');

  return {
    name: typeof product.name === 'string' ? product.name : undefined,
    description:
      typeof product.description === 'string' ? product.description : undefined,
    price,
    images,
  };
}

export async function fetchProductPage(
  url: string,
): Promise<FetchedProductPage> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`fetch failed with status ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const jsonLdProduct = parseJsonLdProduct($);

  const ogImages = $('meta[property="og:image"]')
    .map((_, el) => $(el).attr('content'))
    .get();
  const imgTags = $('img[src]')
    .map((_, el) => $(el).attr('src'))
    .get();
  const imageUrls = Array.from(
    new Set([...(jsonLdProduct?.images ?? []), ...ogImages, ...imgTags]),
  )
    .map((src) => {
      try {
        return new URL(src, url).toString();
      } catch {
        return null;
      }
    })
    .filter((u): u is string => !!u)
    .slice(0, MAX_IMAGE_URLS);

  const title =
    $('title').first().text().trim() ||
    $('meta[property="og:title"]').attr('content')?.trim() ||
    null;
  const ogDescription =
    $('meta[property="og:description"]').attr('content')?.trim() || null;

  $('script, style, noscript').remove();
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();

  const structuredText = jsonLdProduct
    ? [
        jsonLdProduct.name &&
          `نام محصول (داده‌ی ساختاریافته‌ی سایت): ${jsonLdProduct.name}`,
        jsonLdProduct.description &&
          `توضیح (داده‌ی ساختاریافته‌ی سایت): ${jsonLdProduct.description}`,
        jsonLdProduct.price &&
          `قیمت (داده‌ی ساختاریافته‌ی سایت): ${jsonLdProduct.price}`,
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const text = (structuredText ? `${structuredText}\n\n${bodyText}` : bodyText)
    .trim()
    .slice(0, MAX_PAGE_TEXT_CHARS);

  return { title, ogDescription, text, imageUrls };
}
