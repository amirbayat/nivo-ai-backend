import type { BriefLlmOutput } from './brief.schema';
import { normForMatch } from './normalize';
import { splitSections } from './section-splitter';
import { topicFromHeading, topicsForMessage } from './topics';
import { validateBrief } from './validate';

const RESTA = `دامن پلیسه‌ی رستا یک دامن بلند و زنانه است که برای استفاده روزمره و مهمانی‌های کوچک طراحی شده و خیلی راحت است.

**مشخصات**
جنس: پلی‌استر پیشنهادی؛ باید تأیید شود
طول دامن: ۹۰ سانتی‌متر

**رنگ و سایز و موجودی**
مشکی، سرمه‌ای، شیرمالی. سایزهای ۳۶ تا ۴۶ موجود است و هر رنگ تعداد مشخصی دارد که در سایت دیده می‌شود.

**سایز و اندازه**
سایز ۳۸ دور کمر ۷۴ تا ۷۸ سانتی‌متر است.
سایز ۴۰ دور کمر ۷۹ تا ۸۳ سانتی‌متر است.
سایز ۴۲ دور کمر ۸۴ تا ۸۸ سانتی‌متر است.

نگهداری:
با آب سرد و شوینده ملایم شسته شود و اتو با حرارت کم انجام شود تا چین‌ها خراب نشود.

**تفاوت با مدل‌های مشابه:** پلیسه‌ها ریزتر و ماندگارترند و بعد از شستشو شکل خود را حفظ می‌کنند، نه مثل مدل ساده.

**راهنمای دستیار فروش**
اگر مشتری درباره‌ی سایز پرسید حتماً دور کمر را بپرس. قیمت ۱٬۰۹۰٬۰۰۰ تومان را نگو.`;

describe('splitSections', () => {
  const { text, sections } = splitSections(RESTA);

  it('بخش‌ها با عنوان و offset دقیق', () => {
    const heads = sections.map((s) => s.heading);
    expect(heads).toEqual([null, 'مشخصات', 'رنگ و سایز و موجودی', 'سایز و اندازه', 'نگهداری', 'تفاوت با مدل‌های مشابه', 'راهنمای دستیار فروش']);
    for (const s of sections) expect(text.slice(s.start, s.end)).toBe(text.slice(s.start, s.end).trim());
    expect(text.slice(sections[3].start, sections[3].end)).toContain('دور کمر ۷۴');
    expect(text.slice(sections[3].start, sections[3].end)).not.toContain('آب سرد');
  });

  it('موضوع از فرهنگ عنوان', () => {
    expect(sections.map((s) => topicFromHeading(s.heading))).toEqual([
      null, 'SPECS', 'VARIANTS_STOCK', 'SIZE_FIT', 'CARE', 'COMPARISON', 'SELLER_RULES',
    ]);
  });

  it('عنوان درون‌خطی بخش جدا می‌شود', () => {
    const t = '**نگهداری:** با آب سرد بشویید و اتو نکنید تا شکل پارچه حفظ شود و رنگ نپرد.\n\nمعرفی کوتاه محصول که برای ۸۰ کاراکتر به اندازه‌ی کافی بلند نیست، پس ادغام می‌شود.';
    const r = splitSections(t);
    expect(r.sections[0].heading).toBe('نگهداری');
  });

  it('متن تک‌پاراگرافی بلند به تکه‌های حدود ۴۰۰', () => {
    const sentence = 'این محصول با کیفیت بالا ساخته شده و برای استفاده روزمره بسیار مناسب است. ';
    const r = splitSections(sentence.repeat(40));
    expect(r.sections.length).toBeGreaterThan(4);
    for (const s of r.sections) expect(s.end - s.start).toBeLessThanOrEqual(400);
    // پوشش کامل: چیزی گم نمی‌شود
    const joined = r.sections.map((s) => r.text.slice(s.start, s.end)).join(' ').replace(/\s+/g, ' ');
    expect(joined).toBe(r.text.replace(/\s+/g, ' ').trim());
  });

  it('بخش بلند روی مرز bullet شکسته می‌شود و هر بخش ≤ ۱۲۰۰', () => {
    const bullets = Array.from({ length: 30 }, (_, i) => `- ویژگی شماره ${i} این محصول شامل توضیحات نسبتاً طولانی برای پر کردن حجم است`).join('\n');
    const r = splitSections(bullets);
    expect(r.sections.length).toBeGreaterThan(1);
    for (const s of r.sections) {
      expect(s.end - s.start).toBeLessThanOrEqual(1200);
      expect(r.text.slice(s.start, s.end).startsWith('- ')).toBe(true);
    }
  });

  it('خالی/CRLF', () => {
    expect(splitSections('').sections).toEqual([]);
    expect(splitSections(null).sections).toEqual([]);
    const r = splitSections('**معرفی**\r\nمتن کوتاه اما کافی برای یک بخش واقعی که از هشتاد کاراکتر بیشتر باشد و ادامه دارد.');
    expect(r.text).not.toContain('\r');
    expect(r.sections).toHaveLength(1);
  });
});

describe('topicsForMessage', () => {
  it.each([
    ['سایز ۳۸ کمرش چنده؟', 'SIZE_FIT'],
    ['جنسش چیه؟', 'SPECS'],
    ['چطور بشورمش؟', 'CARE'],
    ['برای مهمونی خوبه؟', 'USAGE_STYLING'],
    ['فرقش با مدل ساده چیه؟', 'COMPARISON'],
  ])('%s → %s', (msg, topic) => {
    expect(topicsForMessage(msg)).toContain(topic);
  });
  it('پیام بی‌ربط → خالی', () => expect(topicsForMessage('سلام')).toEqual([]));
});

const base = (): BriefLlmOutput => ({
  sectionTopics: [],
  facts: [],
  caveats: [],
  sellerRules: [],
  pitch: { benefits: [], benefitSources: [], valueLines: [], followUps: [], openers: [] },
  textPriceStock: { prices: [], stockMentions: [] },
});

describe('validateBrief', () => {
  const { text, sections } = splitSections(RESTA);
  const inp = { text, sections, specs: [{ label: 'جنس', value: 'پلی‌استر' }], optionTypes: [{ name: 'سایز', values: ['۳۸', '۴۰'] }] };
  const idOf = (h: string) => sections.find((s) => s.heading === h)!.id;

  it('fact ساختگی حذف و fact واقعی با ارقام فارسی/لاتین نگه داشته می‌شود', () => {
    const o = base();
    o.facts = [
      { k: 'ضد آب', v: 'ضد آب است', sure: true, src: idOf('مشخصات') },
      { k: 'طول', v: '90 سانتی‌متر', sure: true, src: idOf('مشخصات') },
    ];
    const r = validateBrief(o, inp);
    expect(r.brief.facts.map((f) => f.k)).toEqual(['طول']);
  });

  it('کد sure را پایین می‌آورد، هرگز بالا نمی‌برد', () => {
    const o = base();
    o.facts = [
      { k: 'جنس', v: 'پلی‌استر', sure: true, src: idOf('مشخصات') },
      { k: 'طول', v: '۹۰ سانتی‌متر', sure: false, src: idOf('مشخصات') },
    ];
    const r = validateBrief(o, inp);
    expect(r.brief.facts.find((f) => f.k === 'جنس')!.sure).toBe(false); // «پیشنهادی… باید تأیید شود»
    expect(r.brief.facts.find((f) => f.k === 'طول')!.sure).toBe(false); // مدل false داد، می‌ماند
  });

  it('quote بازنویسی‌شده حذف، عین متن می‌ماند', () => {
    const o = base();
    const s = idOf('نگهداری');
    o.caveats = [
      { quote: 'اتو با حرارت کم انجام شود', src: s },
      { quote: 'اتو نکنید اصلاً', src: s },
    ];
    expect(validateBrief(o, inp).brief.caveats).toHaveLength(1);
  });

  it('sellerRule با قیمت حذف می‌شود', () => {
    const o = base();
    const s = idOf('راهنمای دستیار فروش');
    o.sellerRules = [
      { quote: 'حتماً دور کمر را بپرس', src: s },
      { quote: 'قیمت ۱٬۰۹۰٬۰۰۰ تومان را نگو', src: s },
    ];
    expect(validateBrief(o, inp).brief.sellerRules.map((r) => r.quote)).toEqual(['حتماً دور کمر را بپرس']);
  });

  it('pitch: عدد/ادعای بی‌منبع/عالی حذف؛ کمتر از ۲ benefit → null', () => {
    const o = base();
    o.pitch.benefits = ['پلیسه‌ها بعد از شستشو شکل خود را حفظ می‌کنند', 'ضد آب است', 'بهترین دامن بازار', 'فقط ۹۰ سانتی‌متر'];
    o.pitch.benefitSources = ['description', 'description', 'description', 'description'];
    expect(validateBrief(o, inp).brief.pitch).toBeNull();
    o.pitch.benefits.push('پلیسه ریزتر و ماندگارتر است');
    o.pitch.benefitSources.push('description');
    const p = validateBrief(o, inp).brief.pitch!;
    expect(p.benefits).toEqual(['پلیسه‌ها بعد از شستشو شکل خود را حفظ می‌کنند', 'پلیسه ریزتر و ماندگارتر است']);
  });

  it('موضوع: فرهنگ عنوان، سپس LLM، سپس OTHER', () => {
    const o = base();
    const first = sections[0].id;
    o.sectionTopics = [{ id: first, topics: ['OVERVIEW'] }];
    const r = validateBrief(o, inp);
    expect(r.topics[idOf('سایز و اندازه')]).toEqual(['SIZE_FIT']);
    expect(r.topics[first]).toEqual(['OVERVIEW']);
    const r2 = validateBrief(base(), inp);
    expect(r2.topics[first]).toEqual(['OTHER']);
  });

  it('کمتر از نصف facts ماند → ok=false', () => {
    const o = base();
    const s = idOf('مشخصات');
    o.facts = [
      { k: 'الف', v: 'ساختگی یک', sure: true, src: s },
      { k: 'ب', v: 'ساختگی دو', sure: true, src: s },
      { k: 'ج', v: '90 سانتی‌متر', sure: true, src: s },
    ];
    expect(validateBrief(o, inp).ok).toBe(false);
  });

  it('normForMatch', () => {
    expect(normForMatch('۱٬۰۹۰٬۰۰۰ تومان')).toBe('1090000 تومان');
    expect(normForMatch('پلی‌استر')).toBe('پلیاستر');
  });
});

import { BRIEF_PROMPT_RULE, isBriefUsable, readSections, renderBriefFacts, type BriefRow } from './brief-prompt';

describe('brief-prompt', () => {
  const { text, sections } = splitSections(RESTA);
  const v = validateBrief(
    {
      sectionTopics: [{ id: sections[0].id, topics: ['OVERVIEW'] }],
      facts: [{ k: 'جنس', v: 'پلی‌استر', sure: true, src: sections.find((s) => s.heading === 'مشخصات')!.id }],
      caveats: [{ quote: 'اتو با حرارت کم انجام شود', src: sections.find((s) => s.heading === 'نگهداری')!.id }],
      sellerRules: [],
      pitch: { benefits: [], benefitSources: [], valueLines: [], followUps: [], openers: [] },
      textPriceStock: { prices: [], stockMentions: [] },
    },
    { text, sections, specs: [], optionTypes: [] },
  );
  const row: BriefRow = {
    descHash: 'h', status: 'ok', brief: v.brief,
    sections: sections.map((s) => ({ ...s, topics: v.topics[s.id] })),
  };

  it('خط facts: واقعیت با «؟»، قید، دستور فروشنده، فهرست بخش‌ها؛ هرگز رنگ/موجودی', () => {
    const line = renderBriefFacts(row, text);
    expect(line).toContain('جنس: پلی‌استر (؟ فروشنده مطمئن نیست)');
    expect(line).toContain('«اتو با حرارت کم انجام شود»');
    expect(line).toContain('دستور فروشنده به تو:');
    expect(line).toMatch(/s4 سایز و اندازه/);
    expect(line).not.toContain('رنگ و سایز و موجودی');
    expect(line).not.toContain('شیرمالی');
    expect(line.length).toBeLessThan(text.length);
  });

  it('خروجی بین دو فراخوانی بایت‌به‌بایت یکسان است', () => {
    expect(renderBriefFacts(row, text)).toBe(renderBriefFacts(row, text));
  });

  it('readSections: حداکثر ۳، عین متن، VARIANTS_STOCK هرگز', () => {
    const ids = sections.map((s) => s.id);
    const r = readSections(row, text, ids);
    expect(r).toHaveLength(3);
    const stock = sections.find((s) => s.heading === 'رنگ و سایز و موجودی')!.id;
    expect(readSections(row, text, [stock])).toEqual([]);
    const size = sections.find((s) => s.heading === 'سایز و اندازه')!;
    expect(readSections(row, text, [size.id])[0].text).toBe(text.slice(size.start, size.end));
  });

  it('isBriefUsable: hash متفاوت، failed، متن کوتاه، نبود → false', () => {
    expect(isBriefUsable(row, 'h', 900)).toBe(true);
    expect(isBriefUsable(row, 'other', 900)).toBe(false);
    expect(isBriefUsable({ ...row, status: 'failed' }, 'h', 900)).toBe(false);
    expect(isBriefUsable(row, 'h', 500)).toBe(false);
    expect(isBriefUsable(null, 'h', 900)).toBe(false);
    expect(BRIEF_PROMPT_RULE).toContain('read_product_section');
  });
});
