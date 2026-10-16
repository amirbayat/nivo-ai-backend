import { slugFromName, suggestSlug } from './slug-from-name';

// [QA-13] همین جدول عیناً در nivo-ai-frontend/tests/slugFromName.test.ts هم هست؛ دو پیاده‌سازی باید یکی بمانند.
const SLUG_TABLE: Array<[string, string]> = [
  ['فروشگاه تست QA نیوو', 'forooshgah-test-qa-nivo'],
  ['فروشگاه مهتاب', 'forooshgah-mahtab'],
  ['لباس بچه', 'lebas-bache'],
  ['گالری طلای سارا', 'gallery-telai-sara'],
  ['کفش و کیف رضایی', 'kafsh-va-kif-rezaii'],
  ['موبایل پارسیان', 'mobile-parsian'],
  ['پوشاک ۲۴ ساعته', 'pooshak-24-saate'],
  ['دیجی کالا', 'diji-kala'],
  ['زیبایی نگین', 'zibaee-negin'],
  ['لوازم آرایشی ژیلا', 'lavazem-arayeshi-zhila'],
  ['نانوایی سنتی', 'nanvaee-sonati'],
  ['استودیو چرم', 'studio-cherm'],
  ['اسباب بازی کودک', 'asbab-bazi-koodak'],
  ['ویترین', 'vitrin'],
  ['هنر دست', 'honar-dest'],
  ['میوه فروشی نوین', 'mive-foroshi-nooin'],
  ['یاس', 'yas'],
  ['Nivo Shop', 'nivo-shop'],
  ['فروشگاه 3 ستاره', 'forooshgah-3-setare'],
];

describe('slugFromName / suggestSlug [SP-2]', () => {
  it.each(SLUG_TABLE)('%s -> %s', (name, slug) => {
    expect(slugFromName(name)).toBe(slug);
  });

  it('Persian name is transliterated like the frontend helper', () => {
    expect(slugFromName('فروشگاه مهتاب')).toBe('forooshgah-mahtab');
  });

  it('empty or too short name gives empty base', () => {
    expect(slugFromName('')).toBe('');
    expect(slugFromName('ا')).toBe('');
  });

  it('free base is returned as is', async () => {
    await expect(suggestSlug('mahtab', async () => false)).resolves.toEqual({
      slug: 'mahtab',
      requestedAvailable: true,
    });
  });

  it('taken base goes to -2', async () => {
    const taken = new Set(['mahtab']);
    await expect(
      suggestSlug('mahtab', async (s) => taken.has(s)),
    ).resolves.toEqual({
      slug: 'mahtab-2',
      requestedAvailable: false,
    });
  });

  it('-2..-9 all taken falls back to random suffix', async () => {
    const taken = new Set([
      'mahtab',
      ...[2, 3, 4, 5, 6, 7, 8, 9].map((i) => `mahtab-${i}`),
    ]);
    const r = await suggestSlug('mahtab', async (s) => taken.has(s));
    expect(r.requestedAvailable).toBe(false);
    expect(r.slug).toMatch(/^mahtab-[a-z0-9]{4}$/);
  });

  it('empty base gives shop-xxxxxx', async () => {
    const r = await suggestSlug('', async () => false);
    expect(r.slug).toMatch(/^shop-[a-z0-9]{6}$/);
  });
});
