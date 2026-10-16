import { ConversationEngineService } from './conversation-engine.service';

// docs/PRD-buyer-chat-redesign.md B3 — دکمه‌های سبد (اکشن) بدون caption()، با جمله‌ی قالبی؛ متن تایپی عوض نمی‌شود
describe('cart button templates [BC-4 B3]', () => {
  const product = { id: 'p1', name: 'مانتو', basePrice: 1000, stock: 10 };
  function build(appliedDiscount: unknown = null, previewValid = true) {
    const caption = jest.fn().mockResolvedValue('جمله‌ی مدل');
    const logReply = jest.fn().mockResolvedValue(undefined);
    const eng = Object.create(ConversationEngineService.prototype) as Record<string, any>;
    Object.assign(eng, {
      caption,
      logReply,
      persistTransition: jest.fn().mockResolvedValue(undefined),
      resetClarifyAttempts: jest.fn().mockResolvedValue(undefined),
      assertCartEditable: jest.fn().mockResolvedValue(undefined),
      replaceLatestCartSummary: jest.fn().mockResolvedValue(false),
      previewDiscount: jest.fn().mockResolvedValue(
        previewValid
          ? { valid: true, id: 'd1', code: 'OFF', amountToman: 100, newTotal: 900 }
          : { valid: false },
      ),
      prisma: {
        product: { findUnique: jest.fn().mockResolvedValue({ ...product, storeId: 's1', variants: [], optionTypes: [] }) },
      },
      resolveProductPrices: jest.fn().mockResolvedValue(undefined),
    });
    const conversation = { id: 'c1', storeId: 's1', currentState: 'BROWSING', abVariant: 'A' };
    const ctx = { cart: [] as unknown[], appliedDiscount };
    return { eng, caption, logReply, conversation, ctx };
  }

  it('button add: template text, no caption call', async () => {
    const { eng, caption, conversation, ctx } = build();
    const res = await eng.applyCartUpdate(conversation, ctx, product, null, 1, false, 'ADD_TO_CART', true);
    expect(caption).not.toHaveBeenCalled();
    expect(res.reply).toBe('✓ مانتو به سبدت اضافه شد. جمع سبد: ۱٬۰۰۰ تومان.');
  });

  it('typed add still goes through caption()', async () => {
    const { eng, caption, conversation, ctx } = build();
    const res = await eng.applyCartUpdate(conversation, ctx, product, null, 1, false, 'ADD_TO_CART');
    expect(caption).toHaveBeenCalledTimes(1);
    expect(res.reply).toBe('جمله‌ی مدل');
  });

  it('button add keeps the discount note line', async () => {
    const { eng, caption, conversation, ctx } = build({ id: 'd1', code: 'OFF', amountToman: 50 });
    const res = await eng.applyCartUpdate(conversation, ctx, product, null, 1, false, 'ADD_TO_CART', true);
    expect(caption).not.toHaveBeenCalled();
    expect(res.reply).toContain('کد تخفیف OFF هنوز روی این سبد فعاله');
    expect(res.reply).toContain('جمع سبد: ۹۰۰ تومان');
  });

  it('qty change and remove use templates; removing the last line says the cart is empty', async () => {
    const line = { productId: 'p1', name: 'مانتو', unitPrice: 1000, qty: 2 };
    const a = build();
    a.ctx.cart = [line];
    const qty = await a.eng.setCartLine(a.conversation, a.ctx, { type: 'SET_CART_QTY', productId: 'p1', qty: 3 });
    expect(qty.reply).toBe('تعداد مانتو شد ۳. جمع سبد: ۳٬۰۰۰ تومان.');
    const b = build();
    b.ctx.cart = [line, { productId: 'p2', name: 'کیف', unitPrice: 500, qty: 1 }];
    const removed = await b.eng.setCartLine(b.conversation, b.ctx, { type: 'REMOVE_CART_ITEM', productId: 'p2' });
    expect(removed.reply).toBe('کیف از سبد حذف شد.');
    const c = build();
    c.ctx.cart = [line];
    const emptied = await c.eng.setCartLine(c.conversation, c.ctx, { type: 'REMOVE_CART_ITEM', productId: 'p1' });
    expect(emptied.reply).toBe('سبدت خالی شد.');
    for (const x of [a, b, c]) expect(x.caption).not.toHaveBeenCalled();
  });
});
