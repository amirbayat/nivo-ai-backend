import { slugFromName, suggestSlug } from './slug-from-name';

describe('slugFromName / suggestSlug [SP-2]', () => {
  it('Persian name is transliterated like the frontend helper', () => {
    expect(slugFromName('فروشگاه مهتاب')).toBe('froshgah-mhtab');
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
    await expect(suggestSlug('mahtab', async (s) => taken.has(s))).resolves.toEqual({
      slug: 'mahtab-2',
      requestedAvailable: false,
    });
  });

  it('-2..-9 all taken falls back to random suffix', async () => {
    const taken = new Set(['mahtab', ...[2, 3, 4, 5, 6, 7, 8, 9].map((i) => `mahtab-${i}`)]);
    const r = await suggestSlug('mahtab', async (s) => taken.has(s));
    expect(r.requestedAvailable).toBe(false);
    expect(r.slug).toMatch(/^mahtab-[a-z0-9]{4}$/);
  });

  it('empty base gives shop-xxxxxx', async () => {
    const r = await suggestSlug('', async () => false);
    expect(r.slug).toMatch(/^shop-[a-z0-9]{6}$/);
  });
});
