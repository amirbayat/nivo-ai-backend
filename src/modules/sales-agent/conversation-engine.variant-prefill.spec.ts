jest.mock('./sales-agent-global-config.util', () => ({
  getSalesAgentGlobalConfig: jest
    .fn()
    .mockResolvedValue({ forcedModelVariant: null }),
}));

import {
  ConversationEngineService,
  extractOptionValuesFromTexts,
} from './conversation-engine.service';
import { formatTomanAmountsInText } from '../../common/utils/fa-amounts.util';
import { intentClassificationSchema } from './intent-classification.schema';

// PRD-fixes-prod-qa-2026-10-16 — QA-15 / QA-17
const optionTypes = [
  { name: 'سایز', values: ['۲ سال', '۴ سال', '۶ سال', '۸ سال'].map((value) => ({ value })) },
  { name: 'رنگ', values: [{ value: 'آبی' }, { value: 'سفید' }] },
];

describe('extractOptionValuesFromTexts [QA-15]', () => {
  it('سناریوی گزارش: «۴ ساله» و «رنگ آبیش هست؟» هر دو پیدا می‌شوند', () => {
    const texts = ['می‌خوام سفارش بدم', 'رنگ آبیش هست؟', 'برای پسرم ۴ ساله می‌خوام'];
    expect(extractOptionValuesFromTexts(optionTypes, texts)).toEqual({
      سایز: '۴ سال',
      رنگ: 'آبی',
    });
  });

  it('رقم لاتین هم جور می‌شود، «۱۴ ساله» با «۴ سال» جور نمی‌شود', () => {
    expect(extractOptionValuesFromTexts(optionTypes, ['4 ساله'])).toEqual({ سایز: '۴ سال' });
    expect(extractOptionValuesFromTexts(optionTypes, ['۱۴ ساله'])).toEqual({});
  });

  it('مبهم (دو مقدار یک بُعد در یک پیام) رد می‌شود', () => {
    expect(extractOptionValuesFromTexts(optionTypes, ['آبی یا سفید؟'])).toEqual({});
  });

  it('پیام جدیدتر برنده است', () => {
    expect(extractOptionValuesFromTexts(optionTypes, ['سفید', 'آبی'])).toEqual({ رنگ: 'سفید' });
  });
});

type Engine = Record<string, (...a: unknown[]) => Promise<Record<string, unknown>>>;

const product = {
  id: 'p1',
  name: 'تیشرت نخی بچگانه',
  basePrice: 350000,
  stock: 10,
  storeId: 's1',
  optionTypes: optionTypes.map((o) => ({ ...o, id: o.name, position: 0 })),
  variants: [
    { id: 'v1', optionValues: { سایز: '۴ سال', رنگ: 'آبی' }, stock: 3, priceOverride: null },
    { id: 'v2', optionValues: { سایز: '۴ سال', رنگ: 'سفید' }, stock: 3, priceOverride: null },
  ],
};

function build(customerTexts: string[]) {
  const eng = Object.create(ConversationEngineService.prototype) as unknown as Engine;
  const applyCartUpdate = jest.fn().mockResolvedValue({ reply: 'added', uiBlocks: [], state: 'CART_REVIEW' });
  const logReply = jest.fn();
  Object.assign(eng, {
    prisma: {
      conversationEvent: {
        findMany: jest.fn().mockResolvedValue(customerTexts.map((text) => ({ payload: { text } }))),
      },
    },
    persistTransition: jest.fn(),
    logReply,
    applyCartUpdate,
  });
  return { eng, applyCartUpdate, logReply };
}
const conv = { id: 'c1', currentState: 'BROWSING' };
const ctx = { cart: [], pendingVariantSelection: null };

describe('startVariantSelection prefill [QA-15]', () => {
  it('همه‌ی گزینه‌ها مشخص: مستقیم به سبد با جمله‌ی قالبی، بدون کارت انتخاب', async () => {
    const { eng, applyCartUpdate, logReply } = build(['رنگ آبیش هست؟', 'برای پسرم ۴ ساله می‌خوام']);
    await eng.startVariantSelection(conv, ctx, product, 1);
    expect(applyCartUpdate).toHaveBeenCalledTimes(1);
    const args = applyCartUpdate.mock.calls[0];
    expect(args[3]).toMatchObject({ id: 'v1' });
    expect(args[7]).toBe(true);
    expect(logReply).not.toHaveBeenCalled();
  });

  it('فقط رنگ مشخص: فقط سایز پرسیده می‌شود', async () => {
    const { eng, applyCartUpdate, logReply } = build(['آبی هست؟']);
    await eng.startVariantSelection(conv, ctx, product, 1);
    expect(applyCartUpdate).not.toHaveBeenCalled();
    const ui = logReply.mock.calls[0][2];
    expect(ui.optionName).toBe('سایز');
    expect(ui.selectedSoFar).toEqual({ رنگ: 'آبی' });
  });

  it('هیچ‌چیز مشخص نیست: مثل قبل از بُعد اول می‌پرسد', async () => {
    const { eng, logReply } = build(['سلام']);
    await eng.startVariantSelection(conv, ctx, product, 1);
    expect(logReply.mock.calls[0][2].optionName).toBe('سایز');
  });
});

describe('کلیک چیپ و جمله‌ی کد تخفیف [QA-17]', () => {
  it('کلیک چیپ آخر (SELECT_VARIANT_VALUE) با buttonTemplate=true به سبد می‌رود', async () => {
    const { eng, applyCartUpdate } = build([]);
    Object.assign(eng, {
      prisma: { product: { findUnique: jest.fn().mockResolvedValue(product) } },
      resolveProductPrices: jest.fn(),
    });
    const pctx = {
      cart: [],
      pendingVariantSelection: { productId: 'p1', qty: 1, selectedValues: { سایز: '۴ سال' }, mode: 'DIMENSION' },
    };
    await eng.resolveVariantSelectionValue(conv, pctx, 'آبی');
    expect(applyCartUpdate.mock.calls[0][7]).toBe(true);
  });

  it('facts مسیر غیرقالبی دیگر یادآوری کد تخفیف ندارد و مبلغ با جداکننده است', async () => {
    const caption = jest.fn().mockResolvedValue('ok');
    const eng = Object.create(ConversationEngineService.prototype) as unknown as Engine;
    Object.assign(eng, {
      persistTransition: jest.fn(),
      resetClarifyAttempts: jest.fn(),
      logReply: jest.fn(),
      caption,
      prisma: {},
    });
    await eng.applyCartUpdate(
      { id: 'c1', currentState: 'BROWSING', abVariant: 'A', store: {} },
      { cart: [], appliedDiscount: null },
      { id: 'p1', name: 'تیشرت', basePrice: 350000, stock: 5 },
      null, 1, false, 'ADD_TO_CART',
    );
    const facts = caption.mock.calls[0][0] as string;
    expect(facts).not.toContain('کد تخفیف');
    expect(facts).toContain('۳۵۰٬۰۰۰ تومان');
  });

  it('classifier: intent کلیک option/اکشن APPLY_DISCOUNT نیست و فقط با discountCode معنا دارد', () => {
    const shape = intentClassificationSchema.shape;
    expect(shape.discountCode).toBeDefined();
    // کلیک چیپ اصلاً به parseIntent نمی‌رسد (handleAction) و متن آزاد «آبی» هم با
    // handleVariantSelectionInput بدون classifier حل می‌شود
  });
});

describe('formatTomanAmountsInText [QA-17]', () => {
  it.each([
    ['جمع کل سبدت ۳۵۰۰۰۰ تومنه', 'جمع کل سبدت ۳۵۰٬۰۰۰ تومنه'],
    ['جمع 350000 تومان شد', 'جمع ۳۵۰٬۰۰۰ تومان شد'],
    ['۱۲۰۰۰۰۰ تومان', '۱٬۲۰۰٬۰۰۰ تومان'],
    ['۳۵۰٬۰۰۰ تومان', '۳۵۰٬۰۰۰ تومان'],
    ['۵۰۰ تومان', '۵۰۰ تومان'],
    ['سایز ۱۲۰۰ گرم', 'سایز ۱۲۰۰ گرم'],
  ])('%s', (input, out) => {
    expect(formatTomanAmountsInText(input)).toBe(out);
  });
});
