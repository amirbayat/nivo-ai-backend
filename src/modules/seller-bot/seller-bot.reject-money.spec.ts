import { BadRequestException } from '@nestjs/common';
import { SellerBotService } from './seller-bot.service';
import { fa } from '../../i18n/fa';

// R0.13 — جواب به پرامپت قدیمی رد (بدون فلگ پول) نباید خطای ۴۰۰ بیندازد؛ دو دکمه دوباره می‌آید
describe('seller bot reject without money flag [R0.13]', () => {
  const build = (rejectOrder: jest.Mock) => {
    const sendText = jest.fn(async (..._args: unknown[]) => undefined);
    const svc = Object.create(SellerBotService.prototype) as SellerBotService;
    Object.assign(svc, {
      getLinkedStore: async () => ({ sellerId: 'seller', id: 'store' }),
      prisma: { order: { findUnique: async () => ({ id: 'order-a', storeId: 'store' }) } },
      api: { sendText },
      storeService: { rejectOrder },
    });
    return { svc, sendText };
  };

  it('moneyReceivedRequired ← دو دکمه‌ی «پول نشسته/نرسیده» دوباره ارسال می‌شود', async () => {
    const rejectOrder = jest.fn(async () => {
      throw new BadRequestException(fa.order.moneyReceivedRequired);
    });
    const { svc, sendText } = build(rejectOrder);
    await expect(
      svc['handleRejectReasonMessage']({ chat: { id: 1 }, text: 'جعلی' } as never, 'order-a'),
    ).resolves.toBeUndefined();
    const keyboard = sendText.mock.calls[0][2] as {
      inline_keyboard: { callback_data: string }[][];
    };
    expect(keyboard.inline_keyboard[0].map((b) => b.callback_data)).toEqual([
      'sbrm:1:order-a',
      'sbrm:0:order-a',
    ]);
  });

  it('خطای ۴۰۰ دیگر همچنان بالا می‌رود', async () => {
    const rejectOrder = jest.fn(async () => {
      throw new BadRequestException('other');
    });
    const { svc } = build(rejectOrder);
    await expect(
      svc['handleRejectReasonMessage']({ chat: { id: 1 }, text: 'x' } as never, 'order-a'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
