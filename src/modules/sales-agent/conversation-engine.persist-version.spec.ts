import { ConversationEngineService } from './conversation-engine.service';

// PRD-nivo-sales-unified.md تسک 0.4(۵) — نوشتن شرطی روی version؛ در تعارض سبد ادغام می‌شود
type Eng = {
  persistTransition: (
    c: Record<string, unknown>,
    s: string,
    ctx: Record<string, unknown>,
  ) => Promise<void>;
};
const item = (id: string, qty = 1) => ({
  productId: id,
  name: id,
  unitPrice: 1,
  qty,
});

const build = (
  counts: number[],
  latest?: { version: number; cart: unknown[] },
) => {
  const updateMany = jest.fn();
  counts.forEach((c) => updateMany.mockResolvedValueOnce({ count: c }));
  const tx = {
    salesConversation: { updateMany },
    conversationEvent: { create: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    salesConversation: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          latest
            ? { version: latest.version, contextData: { cart: latest.cart } }
            : null,
        ),
    },
  };
  const eng = Object.create(
    ConversationEngineService.prototype,
  ) as unknown as Eng;
  Object.assign(eng, { prisma, logger: { warn: jest.fn(), error: jest.fn() } });
  return { eng, updateMany, tx };
};

describe('persistTransition version guard [0.4]', () => {
  it('بدون تعارض: where روی version فعلی، increment و آپدیت in-memory', async () => {
    const { eng, updateMany, tx } = build([1]);
    const conv = {
      id: 'c1',
      version: 3,
      currentState: 'BROWSING',
      contextData: {},
    };
    await eng.persistTransition(conv, 'CART_REVIEW', { cart: [item('a')] });
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 'c1', version: 3 });
    expect(updateMany.mock.calls[0][0].data.version).toEqual({ increment: 1 });
    expect(conv.version).toBe(4);
    expect(conv.currentState).toBe('CART_REVIEW');
    expect(tx.conversationEvent.create).toHaveBeenCalled();
  });

  it('تعارض: سبد حریف ادغام می‌شود و هیچ آیتمی گم نمی‌شود', async () => {
    const { eng, updateMany } = build([0, 1], {
      version: 7,
      cart: [item('b')],
    });
    const conv = {
      id: 'c1',
      version: 3,
      currentState: 'BROWSING',
      contextData: {},
    };
    await eng.persistTransition(conv, 'CART_REVIEW', { cart: [item('a')] });
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[1][0].where).toEqual({ id: 'c1', version: 7 });
    const written = updateMany.mock.calls[1][0].data.contextData as {
      cart: { productId: string }[];
    };
    expect(written.cart.map((i) => i.productId).sort()).toEqual(['a', 'b']);
    expect(conv.version).toBe(8);
  });

  it('تعارض مکرر → خطا (نه نوشتن کورکورانه)', async () => {
    const { eng } = build([0, 0], { version: 7, cart: [] });
    const conv = {
      id: 'c1',
      version: 3,
      currentState: 'BROWSING',
      contextData: {},
    };
    await expect(
      eng.persistTransition(conv, 'CART_REVIEW', { cart: [] }),
    ).rejects.toThrow(/changed concurrently/);
  });
});
