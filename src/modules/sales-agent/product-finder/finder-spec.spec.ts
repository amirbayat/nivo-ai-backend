import { z } from 'zod';
import {
  GENERIC_SEARCH_PROFILE,
  attributeKeyGroup,
  buildSearchInputSchema,
  optionNameMatches,
  isQueryOnly,
  toFinderSpec,
  tokenizeQuery,
  type StoreSearchProfile,
} from './finder-spec';
import {
  buildLastSearch,
  describeLastSearch,
  nextPageExcludeIds,
} from './finder-output';

const apparel: StoreSearchProfile = {
  hasGold: false,
  hasWeight: false,
  catalogSize: 100,
  optionVocab: [
    { name: 'رنگ', values: ['مشکی', 'سفید'] },
    { name: 'سایز', values: ['41', '42'] },
  ],
  category: 'پوشاک',
};

describe('finder-spec', () => {
  it('اسکیمای هر فروشگاه فقط پارامترهای معنادار آن را دارد', () => {
    const keys = (p: StoreSearchProfile) =>
      Object.keys(buildSearchInputSchema(p).shape);
    expect(keys(apparel)).toContain('attributes');
    expect(keys(apparel)).not.toContain('maxWagePercent');
    expect(keys(apparel)).not.toContain('maxWeightGrams');
    expect(keys(GENERIC_SEARCH_PROFILE)).toContain('maxWagePercent');
  });

  it('به JSON schema تبدیل می‌شود (ورودی ابزار AI SDK)', () => {
    expect(() =>
      z.toJSONSchema(buildSearchInputSchema(GENERIC_SEARCH_PROFILE)),
    ).not.toThrow();
  });

  it('ارقام فارسی، جابه‌جایی min/max، حذف پارامتر خارج از پروفایل', () => {
    const { spec, notes } = toFinderSpec(
      {
        minPrice: '۳۰۰۰۰۰۰',
        maxPrice: '۱,۰۰۰,۰۰۰',
        maxWagePercent: 10,
        karat: 18,
        limit: 99,
      },
      apparel,
    );
    expect(spec.minPrice).toBe(1_000_000);
    expect(spec.maxPrice).toBe(3_000_000);
    expect(spec.maxWagePercent).toBeUndefined();
    expect(spec.karat).toBeUndefined();
    expect(spec.limit).toBe(8);
    expect(notes.warnings).toHaveLength(0);
  });

  it('maxPrice مشکوک (۳۰۰۰) اعمال می‌شود ولی هشدار می‌گیرد، ضرب خودکار نمی‌شود', () => {
    const { spec, notes } = toFinderSpec(
      { maxPrice: 3000 },
      GENERIC_SEARCH_PROFILE,
    );
    expect(spec.maxPrice).toBe(3000);
    expect(notes.warnings).toHaveLength(1);
  });

  it('توکن‌سازی: کلمات بی‌اثر و جمع ساده حذف می‌شوند', () => {
    expect(tokenizeQuery('یه انگشتر ساده دارید؟')).toEqual(['انگشتر', 'ساده']);
    expect(tokenizeQuery('تیشرت‌ها')).toEqual(['تیشرت']);
  });

  it('isQueryOnly فقط وقتی هیچ فیلتر/مرتب‌سازی نیست', () => {
    expect(
      isQueryOnly(toFinderSpec({ query: 'پیجم رشد نمی‌کنه' }, apparel).spec),
    ).toBe(true);
    expect(
      isQueryOnly(toFinderSpec({ query: 'x', sortBy: 'price' }, apparel).spec),
    ).toBe(false);
    expect(
      isQueryOnly(
        toFinderSpec({ query: 'x', excludeIds: ['a'] }, apparel).spec,
      ),
    ).toBe(false);
  });
  it('§۱۱.۸: excludeIds در اسکیمای مدل نیست، nextPage هست', () => {
    const keys = Object.keys(buildSearchInputSchema(apparel).shape);
    expect(keys).toContain('nextPage');
    expect(keys).not.toContain('excludeIds');
    expect(
      toFinderSpec({ sortBy: 'price', nextPage: true }, apparel).notes.nextPage,
    ).toBe(true);
    expect(toFinderSpec({ sortBy: 'price' }, apparel).notes.nextPage).toBe(
      false,
    );
  });

  it('§۱۱.۸: maxPrice صفر نادیده؛ inStockOnly:false مسیر را ساختاریافته می‌کند', () => {
    expect(
      toFinderSpec({ maxPrice: 0 }, apparel).spec.maxPrice,
    ).toBeUndefined();
    expect(
      isQueryOnly(
        toFinderSpec({ query: 'x', inStockOnly: false }, apparel).spec,
      ),
    ).toBe(false);
  });

  it('§۱۱.۸: تطابق اسم گزینه شمولی است', () => {
    const keys = attributeKeyGroup('سایز')!;
    expect(optionNameMatches('سایز پا', keys)).toBe(true);
    expect(optionNameMatches('شماره کفش', keys)).toBe(true);
    expect(optionNameMatches('رنگ', keys)).toBe(false);
  });

  it('§۱۱.۸: خط lastSearch شناسه ندارد و بعد از ۳۰ دقیقه نمی‌آید', () => {
    const ls = buildLastSearch(
      toFinderSpec({ sortBy: 'price' }, apparel).spec,
      12,
      ['id-aaa', 'id-bbb'],
    );
    const line = describeLastSearch(ls, ls.at)!;
    expect(line).not.toContain('id-aaa');
    expect(line).toContain('nextPage');
    expect(describeLastSearch(ls, ls.at! + 31 * 60 * 1000)).toBeNull();
    expect(describeLastSearch({ ...ls, at: undefined })).toBeNull();
    expect(nextPageExcludeIds(ls)).toEqual(['id-aaa', 'id-bbb']);
  });
});
