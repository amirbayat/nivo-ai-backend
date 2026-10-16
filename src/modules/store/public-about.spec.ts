import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { StoreService } from './store.service';

// docs/PRD-buyer-chat-redesign.md B4 — GET stores/:slug/about
describe('getPublicAbout [BC-3 B4]', () => {
  function build(over: { store?: Record<string, unknown> | null; orders?: number; cards?: number; samples?: number } = {}) {
    const store =
      over.store === null
        ? null
        : {
            id: 'about-' + Math.random(),
            name: 'مهتاب',
            slug: 'mahtab',
            status: 'ACTIVE',
            logoImageKey: 'logo.png',
            createdAt: new Date('2026-03-05T10:00:00Z'),
            requiresShipping: true,
            shippingDaysMin: 2,
            shippingDaysMax: 4,
            returnPolicy: '  تعویض تا ۷ روز  ',
            snapppayPaymentLink: 'https://snapppay.ir/social/x',
            // فیلدهای خصوصی که هرگز نباید بیرون بروند
            ownerTelegramChatId: '999',
            instagramAccessToken: 'secret',
            ...(over.store ?? {}),
          };
    const svc = Object.create(StoreService.prototype) as StoreService;
    Object.assign(svc, {
      prisma: {
        store: { findUnique: async () => store },
        order: { count: async () => over.orders ?? 0 },
        storeShippingRule: { findMany: async () => [{ cost: 30000 }, { cost: 60000 }] },
        storeBankCard: { count: async () => over.cards ?? 1 },
        $queryRaw: async () => [{ samples: over.samples ?? 0, median_seconds: 7200 }],
      },
    });
    return svc;
  }

  it('hides the order count under 10 and shows it from 10', async () => {
    expect((await build({ orders: 9 }).getPublicAbout('mahtab')).successfulOrders).toBeNull();
    expect((await build({ orders: 10 }).getPublicAbout('mahtab')).successfulOrders).toBe(10);
  });

  it('returns null ETA without enough samples and a label with them', async () => {
    expect((await build({ samples: 1 }).getPublicAbout('mahtab')).approvalEtaLabel).toBeNull();
    expect((await build({ samples: 9 }).getPublicAbout('mahtab')).approvalEtaLabel).toBe('حدود ۲ ساعت');
  });

  it('exposes exactly the whitelisted fields (no cards, phones, tokens, owner)', async () => {
    const about = await build({ orders: 12, samples: 9 }).getPublicAbout('mahtab');
    expect(Object.keys(about).sort()).toEqual(
      [
        'approvalEtaLabel',
        'logoKey',
        'memberSince',
        'name',
        'paymentMethods',
        'returnPolicyText',
        'shippingCostRange',
        'shippingDaysText',
        'successfulOrders',
      ].sort(),
    );
    expect(JSON.stringify(about)).not.toMatch(/secret|999|snapppay\.ir/);
    expect(about.memberSince).toBe('2026-03');
    expect(about.returnPolicyText).toBe('تعویض تا ۷ روز');
    expect(about.shippingCostRange).toEqual({ minCostToman: 30000, maxCostToman: 60000 });
    expect(about.paymentMethods).toEqual(['CARD_TO_CARD', 'SNAPPPAY']);
  });

  it('suspended store is 403, unknown or inactive store is 404', async () => {
    await expect(build({ store: { status: 'SUSPENDED' } }).getPublicAbout('x')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(build({ store: null }).getPublicAbout('x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build({ store: { status: 'DRAFT' } }).getPublicAbout('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});
