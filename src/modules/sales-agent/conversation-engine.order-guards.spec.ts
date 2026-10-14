import { ConversationEngineService } from './conversation-engine.service';

// PRD-nivo-sales-unified.md تسک‌های 0.2 و 0.3 — دستکاری qty، تغییر قیمت و موجودی هنگام ثبت سفارش
type Engine = {
  computeCartMutation: (...a: unknown[]) => { ok: boolean };
  executeCreateOrder: (...a: unknown[]) => Promise<Record<string, unknown>>;
};

const product = { id: 'p1', name: 'کفش', basePrice: 1000, stock: 5 };

describe('computeCartMutation qty guard [0.2]', () => {
  const eng = Object.create(
    ConversationEngineService.prototype,
  ) as unknown as Engine;
  it.each([-3, -1, 0, 1.5, 51])('qty=%p رد می‌شود', (qty) => {
    expect(eng.computeCartMutation([], product, null, qty, false).ok).toBe(
      false,
    );
  });
  it('qty معتبر قبول می‌شود', () => {
    expect(eng.computeCartMutation([], product, null, 2, false).ok).toBe(true);
  });
  it('جمع شدن با خط قبلی نباید از موجودی/سقف بگذرد', () => {
    const cart = [{ productId: 'p1', name: 'کفش', unitPrice: 1000, qty: 4 }];
    expect(eng.computeCartMutation(cart, product, null, 2, false).ok).toBe(
      false,
    );
  });
});

describe('executeCreateOrder guards [0.2/0.3]', () => {
  const baseCart = [{ productId: 'p1', name: 'کفش', unitPrice: 1000, qty: 2 }];
  const setup = (live: Record<string, unknown>[] | null, cart = baseCart) => {
    const tx = {
      product: {
        findMany: jest.fn().mockResolvedValue(
          live ?? [
            {
              id: 'p1',
              basePrice: 1000,
              stock: 5,
              variants: [],
              hasFulfillmentDelay: false,
            },
          ],
        ),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      customer: { findUnique: jest.fn().mockResolvedValue({ channel: 'WEB' }) },
      store: {
        findUnique: jest.fn().mockResolvedValue({
          returnPolicyMode: 'NONE',
          returnWindowDays: 7,
          returnShippingPaidBy: 'BUYER',
        }),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'o1',
          paymentMethod: 'CARD_TO_CARD',
          totalAmount: data.totalAmount,
        })),
      },
    };
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    const eng = Object.create(
      ConversationEngineService.prototype,
    ) as unknown as Engine;
    Object.assign(eng, {
      prisma,
      resolveProductPrices: jest.fn(),
      previewDiscount: jest.fn().mockResolvedValue({
        valid: true,
        id: 'd1',
        amountToman: 100,
      }),
      cardSelector: {
        hasPayableCard: jest.fn().mockResolvedValue(true),
        selectCard: jest
          .fn()
          .mockResolvedValue({ id: 'c1', cardNumber: '6037', ownerName: 'x' }),
      },
      persistTransition: jest.fn().mockResolvedValue(undefined),
      orderNotifications: { onPlaced: jest.fn().mockResolvedValue(undefined) },
      logger: { error: jest.fn() },
    });
    const conversation = {
      id: 'cv1',
      storeId: 'st1',
      store: {},
      currentState: 'CART_REVIEW',
    };
    const ctx = {
      cart,
      appliedDiscount: { code: 'OFF', id: 'd1', amountToman: 100 },
    };
    return { eng, tx, conversation, ctx };
  };

  it('qty منفی → blocked و بدون ساخت سفارش/مصرف کد', async () => {
    const { eng, tx, conversation, ctx } = setup(null, [
      { productId: 'p1', name: 'کفش', unitPrice: 1000, qty: -3 },
    ]);
    const r = await eng.executeCreateOrder(conversation, ctx);
    expect(r).toMatchObject({ status: 'blocked', reason: 'INVALID_QTY' });
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('قیمت عوض شده → blocked با سبد به‌روز؛ سفارش ساخته نمی‌شود و کد مصرف نمی‌شود', async () => {
    const { eng, tx, conversation, ctx } = setup([
      {
        id: 'p1',
        basePrice: 1500,
        stock: 5,
        variants: [],
        hasFulfillmentDelay: false,
      },
    ]);
    const r = await eng.executeCreateOrder(conversation, ctx);
    expect(r).toMatchObject({ status: 'blocked', reason: 'PRICE_CHANGED' });
    expect((r.cart as { unitPrice: number }[])[0].unitPrice).toBe(1500);
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(
      (eng as unknown as { persistTransition: jest.Mock }).persistTransition,
    ).toHaveBeenCalled();
  });

  it('موجودی ناکافی → blocked OUT_OF_STOCK', async () => {
    const { eng, tx, conversation, ctx } = setup([
      {
        id: 'p1',
        basePrice: 1000,
        stock: 1,
        variants: [],
        hasFulfillmentDelay: false,
      },
    ]);
    const r = await eng.executeCreateOrder(conversation, ctx);
    expect(r).toMatchObject({ status: 'blocked', reason: 'OUT_OF_STOCK' });
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('محصول حذف‌شده → blocked OUT_OF_STOCK', async () => {
    const { eng, tx, conversation, ctx } = setup([]);
    const r = await eng.executeCreateOrder(conversation, ctx);
    expect(r).toMatchObject({ status: 'blocked', reason: 'OUT_OF_STOCK' });
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('همه چیز سالم → سفارش با قیمت DB و کد تخفیف داخل همان تراکنش', async () => {
    const { eng, tx, conversation, ctx } = setup(null);
    const r = await eng.executeCreateOrder(conversation, ctx);
    expect(r).toMatchObject({ status: 'created' });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.order.create).toHaveBeenCalledTimes(1);
    expect(tx.order.create.mock.calls[0][0].data.totalAmount).toBe(2000 - 100);
  });

  it('3.4/3.10/3.3: کد سفارش، مهلت پرداخت و رویداد اولیه داخل همان تراکنش ساخته می‌شود', async () => {
    const { eng, tx, conversation, ctx } = setup(null);
    await eng.executeCreateOrder(conversation, ctx);
    const data = tx.order.create.mock.calls[0][0].data;
    expect(data.orderCode).toMatch(/^NV[2-9A-HJKMNP-Z]{6}$/);
    expect(data.paymentDueAt.getTime()).toBeGreaterThan(Date.now());
    expect(data.statusEvents.create).toMatchObject({
      from: null,
      to: 'PENDING_PAYMENT',
      actor: 'BUYER',
    });
    expect(data.returnPolicySnapshot).toMatchObject({
      returnPolicyMode: 'NONE',
    });
  });

  it('چت تستی سفارش نمی‌سازد [F4]', async () => {
    const { eng, tx, conversation, ctx } = setup(null);
    (conversation as unknown as { isTest: boolean }).isTest = true;
    const r = await eng.executeCreateOrder(conversation, ctx);
    expect(r).toEqual({ status: 'test_only' });
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('کارت‌به‌کارت بدون کارت قابل پرداخت → payment_missing و بدون سفارش [F6]', async () => {
    const { eng, tx, conversation, ctx } = setup(null);
    (
      eng as unknown as { cardSelector: { hasPayableCard: jest.Mock } }
    ).cardSelector.hasPayableCard.mockResolvedValue(false);
    const r = await eng.executeCreateOrder(conversation, ctx);
    expect(r).toEqual({ status: 'payment_missing' });
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('برخورد کد سفارش: دوباره تولید می‌شود (pre-check)', async () => {
    const { eng, tx, conversation, ctx } = setup(null);
    tx.order.findUnique
      .mockResolvedValueOnce({ id: 'other' })
      .mockResolvedValueOnce({ id: 'other2' })
      .mockResolvedValue(null);
    const r = await eng.executeCreateOrder(conversation, ctx);
    expect(r).toMatchObject({ status: 'created' });
    expect(tx.order.findUnique).toHaveBeenCalledTimes(3);
  });
});
