jest.mock('./sales-agent-global-config.util', () => ({
  getSalesAgentGlobalConfig: jest
    .fn()
    .mockResolvedValue({ forcedModelVariant: null }),
}));

import { ConversationEngineService } from './conversation-engine.service';

// PRD-nivo-sales-unified.md تسک 0.13b / D-2 + 0.13c
type Engine = {
  handleAction: (c: unknown, a: unknown) => Promise<Record<string, unknown>>;
  handleReceiptUpload: (
    c: unknown,
    k: string,
  ) => Promise<Record<string, unknown>>;
};

describe('handleAction fork when conversation already has an order [0.13b]', () => {
  const build = (hasOrder: boolean) => {
    const tx = {
      salesConversation: {
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({ id: 'fresh', storeId: 'st1' }),
      },
    };
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue(hasOrder ? { id: 'o1' } : null),
      },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      salesConversation: {
        findUnique: jest.fn().mockResolvedValue({ forcedModelVariant: null }),
      },
      appConfig: {},
    };
    const eng = Object.create(
      ConversationEngineService.prototype,
    ) as unknown as Engine;
    const inner = jest
      .fn()
      .mockResolvedValue({ reply: 'ok', uiBlocks: [], state: 'CART_REVIEW' });
    Object.assign(eng, {
      prisma,
      creditService: {
        decideBillingMode: jest.fn().mockResolvedValue('NORMAL'),
      },
      handleActionInner: inner,
      lock: {
        acquireWithRetry: jest.fn().mockResolvedValue('t'),
        acquire: jest.fn().mockResolvedValue('t'),
        release: jest.fn(),
        drain: jest.fn().mockResolvedValue([]),
        pendingCount: jest.fn().mockResolvedValue(0),
      },
      reloadConversation: async (c: unknown) => c,
    });
    return { eng, tx, inner };
  };
  const conv = {
    id: 'old',
    storeId: 'st1',
    customerId: 'cu1',
    archivedAt: null,
  };

  it('بدون سفارش: همان مکالمه و بدون switchedConversationId', async () => {
    const { eng, inner } = build(false);
    const r = await eng.handleAction(conv, { type: 'REORDER', orderId: 'o9' });
    expect(inner.mock.calls[0][0]).toBe(conv);
    expect(r.switchedConversationId).toBeUndefined();
  });

  it('با سفارش: قدیمی آرشیو، جدید ساخته و اکشن روی جدید اجرا می‌شود', async () => {
    const { eng, tx, inner } = build(true);
    const r = await eng.handleAction(conv, {
      type: 'ADD_TO_CART',
      productId: 'p1',
    });
    expect(tx.salesConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'old' } }),
    );
    expect(tx.salesConversation.create.mock.calls[0][0].data.customerId).toBe(
      'cu1',
    );
    expect((inner.mock.calls[0][0] as { id: string }).id).toBe('fresh');
    expect(r.switchedConversationId).toBe('fresh');
  });

  it('اکشن‌های غیر سبد (CONFIRM_CART) هرگز fork نمی‌کنند', async () => {
    const { eng, tx } = build(true);
    await eng.handleAction(conv, { type: 'CONFIRM_CART' });
    expect(tx.salesConversation.create).not.toHaveBeenCalled();
  });
});

describe('handleReceiptUpload [0.13b][0.13c]', () => {
  const setup = (
    transitionChanged: boolean,
    notifyFails: boolean,
    status = 'PENDING_PAYMENT',
  ) => {
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'o1',
          totalAmount: 1000,
          paymentMethod: 'CARD_TO_CARD',
          status,
        }),
        update: jest.fn(),
      },
    };
    // 3.2 — انتقال وضعیت فقط از OrderStateService
    const orderState = {
      transition: jest
        .fn()
        .mockResolvedValue({ changed: transitionChanged, order: {} }),
    };
    const eng = Object.create(
      ConversationEngineService.prototype,
    ) as unknown as Engine;
    Object.assign(eng, {
      prisma,
      orderState,
      orderChannelOf: jest.fn().mockResolvedValue('WEB'),
      persistTransition: jest.fn(),
      lock: {
        acquireWithRetry: jest.fn().mockResolvedValue('t'),
        acquire: jest.fn().mockResolvedValue('t'),
        release: jest.fn(),
        drain: jest.fn().mockResolvedValue([]),
        pendingCount: jest.fn().mockResolvedValue(0),
      },
      reloadConversation: async (c: unknown) => c,
      getContext: jest.fn().mockReturnValue({}),
      caption: jest.fn().mockResolvedValue('رسید دریافت شد'),
      logReply: jest.fn(),
      doClarify: jest
        .fn()
        .mockResolvedValue({ reply: 'noPending', uiBlocks: [], state: 'X' }),
      storage: {
        downloadImage: jest.fn().mockImplementation(async () => {
          if (notifyFails) throw new Error('telegram/network down');
          return Buffer.from('x');
        }),
      },
      verifyReceiptAmount: jest.fn().mockResolvedValue(null),
      notifySellerOfReceipt: jest.fn(),
      logger: { error: jest.fn() },
    });
    return { eng, prisma, orderState };
  };
  const conv = { id: 'cv1', currentState: 'AWAITING_PAYMENT', store: {} };

  it('سفارش غیر PENDING_PAYMENT (مثلاً APPROVED) رسید نمی‌گیرد', async () => {
    const { eng, orderState } = setup(false, false, 'APPROVED');
    const r = await eng.handleReceiptUpload(conv, 'k.jpg');
    expect(r.reply).toBe('noPending');
    expect(orderState.transition).not.toHaveBeenCalled();
  });

  it('انتقال هم‌زمان (changed=false) → رسید دوباره ثبت نمی‌شود', async () => {
    const { eng, orderState } = setup(false, false);
    const r = await eng.handleReceiptUpload(conv, 'k.jpg');
    expect(r.reply).toBe('noPending');
    expect(orderState.transition).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'RECEIPT_SUBMITTED', actor: 'BUYER' }),
    );
  });

  it('خطای دانلود/تلگرام بعد از commit → همچنان پاسخ موفق (نه 500)', async () => {
    const { eng } = setup(true, true);
    const r = await eng.handleReceiptUpload(conv, 'k.jpg');
    expect(r.state).toBe('AWAITING_SELLER_APPROVAL');
    expect(r.reply).toBe('رسید دریافت شد');
  });
});
