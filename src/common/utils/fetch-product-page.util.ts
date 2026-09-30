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

  const ogImages = $('meta[property="og:image"]')
    .map((_, el) => $(el).attr('content'))
    .get();
  const imgTags = $('img[src]')
    .map((_, el) => $(el).attr('src'))
    .get();
  const imageUrls = Array.from(new Set([...ogImages, ...imgTags]))
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
  const text = $('body')
    .text()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PAGE_TEXT_CHARS);

  return { title, ogDescription, text, imageUrls };
}
