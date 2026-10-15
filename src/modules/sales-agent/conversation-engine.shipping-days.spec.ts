import { ConversationEngineService } from './conversation-engine.service';

describe('store profile prompt includes shipping days [R3.3]', () => {
  function build() {
    const svc = Object.create(
      ConversationEngineService.prototype,
    ) as unknown as {
      buildStoreProfileText: (c: unknown) => Promise<string>;
    };
    Object.assign(svc, {
      prisma: { storeShippingRule: { findMany: jest.fn().mockResolvedValue([]) } },
    });
    return svc;
  }
  it('زمان ارسال و متن مرجوعی هر دو در پرامپت هستند', async () => {
    const text = await build().buildStoreProfileText({
      storeId: 's1',
      store: {
        category: null,
        brandIntro: null,
        shippingInfo: null,
        returnPolicy: 'مرجوعی تا ۷ روز',
        shippingDaysMin: 1,
        shippingDaysMax: 3,
      },
    });
    expect(text).toContain('زمان ارسال: معمولاً ۱–۳ روز کاری ارسال می‌شه');
    expect(text).toContain('مرجوعی تا ۷ روز');
  });
});
