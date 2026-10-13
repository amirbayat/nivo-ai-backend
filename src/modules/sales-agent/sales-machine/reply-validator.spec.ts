import { PLAYBOOK } from './sales-playbook';
import {
  buildCorrectiveInstruction,
  normalizeFa,
  sanitizeQuickReplies,
  validateReply,
  type Violation,
} from './reply-validator';
import type { ReplyContract, SalesMemory } from './sales-machine.types';
import { memory } from './sales-machine.test-utils';

const open: ReplyContract = {
  maxChars: 300,
  maxQuestions: 1,
  requireProducts: 'NONE',
  requireQuickReplies: false,
  mustEndWithNextStep: false,
};

function run(
  over: Partial<Parameters<typeof validateReply>[0]> & { text: string },
): Violation[] {
  return validateReply({
    relevantProductIds: [],
    quickReplies: [],
    contract: open,
    mem: memory(),
    lastAgentMessage: null,
    knownAmounts: new Set<number>(),
    catalogSize: 10,
    mutationShortCircuited: false,
    ...over,
  });
}
const codes = (v: Violation[]) => v.map((x) => x.code);

describe('validateReply', () => {
  it('TOO_LONG با تحمل ۲۵٪', () => {
    expect(codes(run({ text: 'ا'.repeat(370) }))).not.toContain('TOO_LONG'); // 300*1.25=375
    expect(codes(run({ text: 'ا'.repeat(380) }))).toContain('TOO_LONG');
  });

  it('TOO_MANY_QUESTIONS (؟ و ?)', () => {
    expect(codes(run({ text: 'رنگ؟ سایز؟' }))).toContain('TOO_MANY_QUESTIONS');
    expect(codes(run({ text: 'رنگ? سایز?' }))).toContain('TOO_MANY_QUESTIONS');
    expect(codes(run({ text: 'کدوم رنگ؟' }))).not.toContain(
      'TOO_MANY_QUESTIONS',
    );
    expect(
      codes(run({ text: 'چی؟', contract: { ...open, maxQuestions: 0 } })),
    ).toContain('TOO_MANY_QUESTIONS');
  });

  it('PRODUCTS_REQUIRED فقط وقتی کاتالوگ خالی نیست', () => {
    const c = PLAYBOOK.RECOMMEND.contract;
    expect(codes(run({ text: 'سلام؟', contract: c }))).toContain(
      'PRODUCTS_REQUIRED',
    );
    expect(
      codes(run({ text: 'سلام؟', contract: c, relevantProductIds: ['p1'] })),
    ).not.toContain('PRODUCTS_REQUIRED');
    expect(
      codes(run({ text: 'سلام؟', contract: c, catalogSize: 0 })),
    ).not.toContain('PRODUCTS_REQUIRED');
  });

  it('PRODUCTS_FORBIDDEN', () => {
    const c: ReplyContract = { ...open, requireProducts: 'FORBIDDEN' };
    expect(
      codes(run({ text: 'x', contract: c, relevantProductIds: ['p1'] })),
    ).toContain('PRODUCTS_FORBIDDEN');
    expect(codes(run({ text: 'x', contract: c }))).not.toContain(
      'PRODUCTS_FORBIDDEN',
    );
  });

  it('QUICK_REPLIES_REQUIRED', () => {
    const c: ReplyContract = { ...open, requireQuickReplies: true };
    expect(
      codes(run({ text: 'x', contract: c, quickReplies: ['الف'] })),
    ).toContain('QUICK_REPLIES_REQUIRED');
    expect(
      codes(run({ text: 'x', contract: c, quickReplies: ['الف', 'ب'] })),
    ).not.toContain('QUICK_REPLIES_REQUIRED');
  });

  it('NO_NEXT_STEP؛ با quickReplies، سؤال یا فعل دعوت پاس می‌شود', () => {
    const c: ReplyContract = { ...open, mustEndWithNextStep: true };
    expect(
      codes(run({ text: 'این شال نخیه و خیلی نرمه.', contract: c })),
    ).toContain('NO_NEXT_STEP');
    expect(
      codes(
        run({ text: 'این شال نخیه.', contract: c, quickReplies: ['باشه'] }),
      ),
    ).not.toContain('NO_NEXT_STEP');
    expect(
      codes(run({ text: 'این شال نخیه. رنگش رو بگی؟', contract: c })),
    ).not.toContain('NO_NEXT_STEP');
    expect(
      codes(run({ text: 'این شال نخیه. سایزت رو بگو', contract: c })),
    ).not.toContain('NO_NEXT_STEP');
  });

  it('BANNED_PHRASE با نرمال‌سازی ی/ي، ک/ك و نیم‌فاصله', () => {
    expect(codes(run({ text: 'در خدمتم' }))).toContain('BANNED_PHRASE');
    expect(codes(run({ text: 'كاملاً درکتون مي‌كنم' }))).toContain(
      'BANNED_PHRASE',
    );
    expect(codes(run({ text: 'سوال دیگه ای دارید؟' }))).toContain(
      'BANNED_PHRASE',
    ); // «سؤال دیگه‌ای دارید»
    expect(codes(run({ text: 'عالیه! این شال خوبه' }))).toContain(
      'BANNED_PHRASE',
    );
    expect(codes(run({ text: 'این شال عالیه و نرم' }))).not.toContain(
      'BANNED_PHRASE',
    );
  });

  it('REPEATED_QUESTION با شباهت ≥ ۰.۸', () => {
    const mem: SalesMemory = memory({
      askedQuestions: [{ text: 'بودجه‌ت چقدره؟', turn: 1 }],
    });
    expect(codes(run({ text: 'بودجه‌ت چقدره؟', mem }))).toContain(
      'REPEATED_QUESTION',
    );
    expect(codes(run({ text: 'رنگ دلخواهت چیه؟', mem }))).not.toContain(
      'REPEATED_QUESTION',
    );
  });

  it('REPEATED_OPENER', () => {
    expect(
      codes(
        run({
          text: 'خوش اومدی عزیزم بگو',
          lastAgentMessage: 'خوش اومدی عزیزم چی میخوای',
        }),
      ),
    ).toContain('REPEATED_OPENER');
    expect(
      codes(
        run({ text: 'باشه حتماً بگو', lastAgentMessage: 'خوش اومدی عزیزم' }),
      ),
    ).not.toContain('REPEATED_OPENER');
  });

  it('MARKDOWN', () => {
    expect(codes(run({ text: 'این **خوبه**' }))).toContain('MARKDOWN');
    expect(codes(run({ text: 'تیتر\n# عنوان' }))).toContain('MARKDOWN');
    expect(codes(run({ text: 'متن ساده' }))).not.toContain('MARKDOWN');
  });

  it('SUSPICIOUS_PRICE (فارسی‌رقم و جداکننده)', () => {
    const known = new Set([500000]);
    expect(
      codes(run({ text: 'قیمتش ۴۹۰,۰۰۰ تومان است', knownAmounts: known })),
    ).toContain('SUSPICIOUS_PRICE');
    expect(
      codes(run({ text: 'قیمتش ۵۰۰,۰۰۰ تومان است', knownAmounts: known })),
    ).not.toContain('SUSPICIOUS_PRICE');
  });

  it('REJECTED_PRODUCT_RECOMMENDED', () => {
    const mem = memory({
      interests: [
        {
          id: 'p9',
          name: 'x',
          priceToman: 1,
          signal: 'REJECTED',
          note: null,
          lastTurn: 1,
        },
      ],
    });
    expect(
      codes(run({ text: 'x', mem, relevantProductIds: ['p9'] })),
    ).toContain('REJECTED_PRODUCT_RECOMMENDED');
    expect(
      codes(run({ text: 'x', mem, relevantProductIds: ['p1'] })),
    ).not.toContain('REJECTED_PRODUCT_RECOMMENDED');
  });

  it('mutationShortCircuited → هیچ تخلفی گزارش نمی‌شود', () => {
    expect(run({ text: 'در خدمتم **', mutationShortCircuited: true })).toEqual(
      [],
    );
  });
});

describe('buildCorrectiveInstruction / sanitizeQuickReplies / normalizeFa', () => {
  it('هر تخلف یک خط دارد', () => {
    const txt = buildCorrectiveInstruction([
      { code: 'TOO_MANY_QUESTIONS', actual: 2, max: 1 },
      { code: 'SUSPICIOUS_PRICE', amounts: [123000] },
    ]);
    expect(txt).toContain('فقط 1 سؤال');
    expect(txt).toContain('123000');
  });

  it('quickReplies: trim، یکتا، برش ۲۵ کاراکتر روی مرز کلمه، سقف ۳', () => {
    const out = sanitizeQuickReplies(
      [
        ' مشکی ',
        'مشکی',
        'یه جمله‌ی خیلی خیلی طولانی که از حد گذشته',
        'الف',
        'ب',
      ],
      { goal: 'ALTERNATIVE_CLOSE' },
    );
    expect(out.length).toBe(3);
    expect(out[0]).toBe('مشکی');
    expect(out[1].length).toBeLessThanOrEqual(25);
  });

  it('quickReplies برای هدف‌های بدون دکمه و فلوهای قطعی خالی است', () => {
    expect(sanitizeQuickReplies(['الف', 'ب'], { goal: 'SOFT_EXIT' })).toEqual(
      [],
    );
    expect(
      sanitizeQuickReplies(['الف', 'ب'], {
        goal: 'RECOMMEND',
        uiBlockType: 'VARIANT_PROMPT',
      }),
    ).toEqual([]);
    expect(
      sanitizeQuickReplies(['الف', 'ب'], {
        goal: 'RECOMMEND',
        uiBlockType: 'PRODUCT_CARD',
      }),
    ).toEqual(['الف', 'ب']);
  });

  it('normalizeFa', () => {
    expect(normalizeFa('كاملاً مي‌كنم')).toBe('کاملا می کنم');
  });
});
