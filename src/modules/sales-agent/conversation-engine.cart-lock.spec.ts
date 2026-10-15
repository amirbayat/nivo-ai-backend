import { ConflictException } from '@nestjs/common';
import { ConversationEngineService } from './conversation-engine.service';
import { fa } from '../../i18n/fa';

const LOCKED = 'سفارشت ثبت شده و سبد دیگه قابل تغییر نیست';

type CartLine = {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
  variantId?: string;
};

describe('setCartLine cart lock [F8]', () => {
  const cart: CartLine[] = [
    { productId: 'p1', name: 'کفش', unitPrice: 1000, qty: 2 },
    { productId: 'p2', name: 'کیف', unitPrice: 500, qty: 1 },
  ];

  const setup = (state: string, order: { id: string } | null = null) => {
    const persistTransition = jest.fn().mockResolvedValue(undefined);
    const logReply = jest.fn().mockResolvedValue(undefined);
    const events = [
      {
        id: 'e1',
        payload: {
          text: 'سبد',
          uiBlock: { type: 'CART_SUMMARY', items: cart, total: 2500 },
        },
      },
    ];
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(order) },
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'p1',
          storeId: 's1',
          name: 'کفش',
          basePrice: 1800,
          stock: 10,
          variants: [],
        }),
      },
      salesConversation: {
        update: jest.fn().mockResolvedValue({}),
      },
      conversationEvent: {
        findMany: jest.fn().mockResolvedValue(events),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const eng = Object.create(ConversationEngineService.prototype) as {
      setCartLine: (
        ...args: unknown[]
      ) => Promise<{ reply: string; uiBlocks?: { type: string }[] }>;
      doUpdateCart: (...args: unknown[]) => Promise<{ reply: string }>;
    };
    Object.assign(eng, { prisma, persistTransition, logReply });
    const conversation = {
      id: 'c1',
      storeId: 's1',
      currentState: state,
      clarifyAttempts: 0,
    };
    const ctx = { cart, appliedDiscount: null };
    return { eng, conversation, ctx, prisma, persistTransition, logReply };
  };

  it('SET_CART_QTY in AWAITING_PAYMENT is 409 and does not write', async () => {
    const { eng, conversation, ctx, persistTransition, logReply } =
      setup('AWAITING_PAYMENT');
    await expect(
      eng.setCartLine(conversation, ctx, {
        type: 'SET_CART_QTY',
        productId: 'p1',
        qty: 3,
      }),
    ).rejects.toMatchObject({
      message: LOCKED,
    });
    await expect(
      eng.setCartLine(conversation, ctx, {
        type: 'SET_CART_QTY',
        productId: 'p1',
        qty: 3,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(persistTransition).not.toHaveBeenCalled();
    expect(logReply).not.toHaveBeenCalled();
  });

  it('SET_CART_QTY is 409 when an order already exists', async () => {
    const { eng, conversation, ctx, persistTransition } = setup('CART_REVIEW', {
      id: 'o1',
    });
    await expect(
      eng.setCartLine(conversation, ctx, {
        type: 'REMOVE_CART_ITEM',
        productId: 'p1',
      }),
    ).rejects.toMatchObject({ message: LOCKED });
    expect(persistTransition).not.toHaveBeenCalled();
  });

  it('REMOVE_FROM_CART (NLU) in AWAITING_PAYMENT clarifies with the lock message instead of throwing [R0.6]', async () => {
    const { eng, conversation, ctx, persistTransition } =
      setup('AWAITING_PAYMENT');
    const doClarify = jest.fn().mockResolvedValue({ reply: LOCKED });
    Object.assign(eng, { doClarify });
    const result = await eng.doUpdateCart(conversation, ctx, {
      intent: 'REMOVE_FROM_CART',
    });
    expect(result.reply).toBe(LOCKED);
    expect(doClarify).toHaveBeenCalledWith(conversation, LOCKED);
    expect(persistTransition).not.toHaveBeenCalled();
  });

  it('update_cart tool in AWAITING_PAYMENT returns the lock error and changes nothing [R0.5]', async () => {
    const { eng, conversation, persistTransition, prisma } =
      setup('AWAITING_PAYMENT');
    const rt = {
      ctx: { cart: [...cart], appliedDiscount: null },
      mutationHappened: false,
    };
    const tools = (
      eng as unknown as {
        buildAgentTools: (...a: unknown[]) => {
          update_cart: { execute: (a: unknown, o?: unknown) => Promise<unknown> };
        };
      }
    ).buildAgentTools({ ...conversation, store: { leadCaptureOnly: false } }, rt, {
      persuasionEnabled: false,
      respondToCustomer: {},
    });
    const result = await tools.update_cart.execute(
      { productId: 'p1', qty: 1 },
      { toolCallId: 't', messages: [] },
    );
    expect(result).toEqual({ error: LOCKED });
    expect(persistTransition).not.toHaveBeenCalled();
    expect(prisma.product.findUnique).not.toHaveBeenCalled();
    expect(rt.ctx.cart).toEqual(cart);
    expect(rt.mutationHappened).toBe(false);
  });

  it('qty 0 uses the invalid-qty sentence', async () => {
    const { eng, conversation, ctx } = setup('CART_REVIEW');
    const result = await eng.setCartLine(conversation, ctx, {
      type: 'SET_CART_QTY',
      productId: 'p1',
      qty: 0,
    });
    expect(result.reply).toBe(fa.salesAgent.cartInvalidQty);
    expect(result.reply).not.toBe(fa.salesAgent.insufficientStock);
  });

  it('a legal qty change keeps the line in place, uses the current price, and updates the old summary', async () => {
    const { eng, conversation, ctx, prisma, persistTransition, logReply } =
      setup('BROWSING');
    const result = await eng.setCartLine(conversation, ctx, {
      type: 'SET_CART_QTY',
      productId: 'p1',
      qty: 3,
    });
    const saved = persistTransition.mock.calls[0][2] as { cart: CartLine[] };
    expect(saved.cart.map((line) => line.productId)).toEqual(['p1', 'p2']);
    expect(saved.cart[0]).toMatchObject({ qty: 3, unitPrice: 1800 });
    expect(logReply).not.toHaveBeenCalled();
    expect(prisma.conversationEvent.update).toHaveBeenCalled();
    expect(result.uiBlocks?.[0]).toMatchObject({
      type: 'CART_SUMMARY',
      items: saved.cart,
    });
  });
});
