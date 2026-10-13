import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SalesActionDto } from './dto/send-message.dto';
import { ConversationEngineService } from './conversation-engine.service';

// 0.11a — اکشن FOCUS_PRODUCT برای خریدار برگشتی با لینک محصول
describe('FOCUS_PRODUCT [0.11a]', () => {
  it('DTO آن را می‌پذیرد', async () => {
    const dto = plainToInstance(SalesActionDto, {
      type: 'FOCUS_PRODUCT',
      productId: 'p1',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('کارت محصول را بدون LLM (showProduct) برمی‌گرداند و محصول بیگانه را رد می‌کند', async () => {
    const eng = Object.create(
      ConversationEngineService.prototype,
    ) as unknown as {
      handleActionInner: (
        c: unknown,
        a: unknown,
      ) => Promise<Record<string, unknown>>;
    };
    const showProduct = jest
      .fn()
      .mockResolvedValue({ reply: 'کارت', uiBlocks: [], state: 'BROWSING' });
    const doClarify = jest
      .fn()
      .mockResolvedValue({ reply: 'نیست', uiBlocks: [], state: 'BROWSING' });
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ id: 'p1', storeId: 'st1' })
      .mockResolvedValueOnce({ id: 'p2', storeId: 'OTHER' });
    Object.assign(eng, {
      prisma: { product: { findUnique } },
      checkAbuseGuard: jest.fn().mockResolvedValue(null),
      billingBlocked: jest.fn().mockReturnValue(false),
      getContext: jest.fn().mockReturnValue({ cart: [] }),
      showProduct,
      doClarify,
    });
    const conv = { id: 'c1', storeId: 'st1' };
    expect(
      (
        await eng.handleActionInner(conv, {
          type: 'FOCUS_PRODUCT',
          productId: 'p1',
        })
      ).reply,
    ).toBe('کارت');
    expect(
      (
        await eng.handleActionInner(conv, {
          type: 'FOCUS_PRODUCT',
          productId: 'p2',
        })
      ).reply,
    ).toBe('نیست');
    expect(showProduct).toHaveBeenCalledTimes(1);
  });
});
