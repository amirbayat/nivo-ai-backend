import { buildLayerReport, pickForJudging, finalVerdict } from './shadow-report';
import type { ShadowSample, Verdict } from './shadow-store';

let n = 0;
const mk = (o: Partial<ShadowSample> & { v?: Verdict; hv?: Verdict }): ShadowSample => ({
  id: `i${n++}`, ts: 0, layer: 'fastAnswers', intent: 'ASK_PRICE', customerMessage: 'قیمت؟', realText: 'a', candidateText: 'b', tags: [],
  storeCategory: 'مد',
  ...(o.v ? { judge: { verdict: o.v, reason: 'r', at: 0 } } : {}),
  ...(o.hv ? { human: { verdict: o.hv, at: 0 } } : {}),
  ...o,
});
const many = (k: number, o: Partial<ShadowSample> & { v?: Verdict; hv?: Verdict }) => Array.from({ length: k }, () => mk(o));

describe('shadow report', () => {
  it('کمتر از ۲۰۰ نمونه‌ی داوری‌شده → دروازه بسته', () => {
    const r = buildLayerReport('fastAnswers', many(150, { v: 'equal' }));
    expect(r.gate.passes).toBe(false);
    expect(r.gate.reason).toContain('150/200');
  });

  it('۲۰۰ equal و بدون نیت حساس → باز', () => {
    expect(buildLayerReport('fastAnswers', many(200, { v: 'equal' })).gate.passes).toBe(true);
  });

  it('یک wrong دروازه را می‌بندد؛ worse تا ۵٪ مجاز', () => {
    expect(buildLayerReport('fastAnswers', [...many(199, { v: 'equal' }), mk({ v: 'wrong' })]).gate.passes).toBe(false);
    expect(buildLayerReport('fastAnswers', [...many(190, { v: 'equal' }), ...many(10, { v: 'worse' })]).gate.passes).toBe(true);
    expect(buildLayerReport('fastAnswers', [...many(188, { v: 'equal' }), ...many(12, { v: 'worse' })]).gate.passes).toBe(false);
  });

  it('stratum کم‌نمونه دروازه را می‌بندد', () => {
    const r = buildLayerReport('fastAnswers', [...many(200, { v: 'equal' }), ...many(5, { v: 'equal', intent: 'STOCK_CHECK' })]);
    expect(r.gate.passes).toBe(false);
    expect(r.gate.reason).toContain('STOCK_CHECK');
  });

  it('نیت حساس بدون ۵۰ بازبینی انسانی → بسته؛ با ۵۰ → باز', () => {
    const base = [...many(200, { v: 'equal' }), ...many(30, { v: 'equal', intent: 'VARIANT_REQUEST' })];
    expect(buildLayerReport('fastAnswers', base).gate.passes).toBe(false);
    const withHuman = [...many(200, { v: 'equal' }), ...many(50, { v: 'equal', hv: 'equal', intent: 'VARIANT_REQUEST' })];
    expect(buildLayerReport('fastAnswers', withHuman).gate.passes).toBe(true);
  });

  it('حکم انسان بر judge مقدم است و اختلاف شمرده می‌شود', () => {
    const s = mk({ v: 'equal', hv: 'wrong' });
    expect(finalVerdict(s)).toBe('wrong');
    expect(buildLayerReport('fastAnswers', [s]).judgeHumanDisagree).toBe(1);
  });

  it('semanticCache: هر باند دروازه‌ی جدا (verified ≥۹۵٪)', () => {
    const s = [...many(190, { layer: 'semanticCache', band: 'verified', v: 'equal' }), ...many(10, { layer: 'semanticCache', band: 'verified', v: 'worse' })];
    expect(buildLayerReport('semanticCache', s, 'verified').gate.passes).toBe(true);
    expect(buildLayerReport('semanticCache', s, 'exact').gate.passes).toBe(false);
  });

  it('pickForJudging: لایه‌بندی، stratum کم‌داوری اول', () => {
    const all = [...many(10, { intent: 'ASK_PRICE', v: 'equal' }), ...many(5, { intent: 'ASK_PRICE' }), ...many(5, { intent: 'STOCK_CHECK' })];
    const picked = pickForJudging(all, 4);
    expect(picked.filter((p) => p.intent === 'STOCK_CHECK').length).toBe(4);
  });
});
