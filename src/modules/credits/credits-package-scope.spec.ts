import { NotFoundException } from '@nestjs/common';
import { CreditsService } from './credits.service';

function makeService(pkg: Record<string, unknown>) {
  const svc = Object.create(CreditsService.prototype) as CreditsService;
  const payments = {
    initiateCreditTopup: jest.fn().mockResolvedValue({ paymentUrl: 'u' }),
    confirmBazaarPurchase: jest.fn().mockResolvedValue(undefined),
  };
  Object.assign(svc, {
    payments,
    getConfig: jest.fn().mockResolvedValue({ tomanPerCredit: 1000 }),
    getBalance: jest.fn().mockResolvedValue({ credits: 1 }),
    prisma: { creditPackage: { findUnique: jest.fn().mockResolvedValue(pkg) } },
  });
  return { svc, payments };
}

const base = {
  id: 'p1',
  credits: 10,
  discountPercent: 0,
  isActive: true,
  isCustomAmount: false,
  bazaarSku: 'sku',
  storeId: null,
};

describe('0.13e — بسته‌ی اعتبار فروشگاه به کیف‌پول عمومی شارژ نمی‌شود', () => {
  it.each(['STORE_AI_CREDIT', 'NIVO_CAL_BAZAAR'])(
    'purchasePackage با scope=%s رد می‌شود',
    async (scope) => {
      const { svc, payments } = makeService({ ...base, scope });
      await expect(
        svc.purchasePackage('u1', { packageId: 'p1' } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(payments.initiateCreditTopup).not.toHaveBeenCalled();
    },
  );

  it('بسته‌ی اختصاصی یک فروشگاه حتی با scope=GENERAL رد می‌شود', async () => {
    const { svc, payments } = makeService({
      ...base,
      scope: 'GENERAL',
      storeId: 's1',
    });
    await expect(
      svc.purchasePackage('u1', { packageId: 'p1' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(payments.initiateCreditTopup).not.toHaveBeenCalled();
  });

  it('GENERAL و NIVO_CAL عمومی مجازند', async () => {
    for (const scope of ['GENERAL', 'NIVO_CAL']) {
      const { svc, payments } = makeService({ ...base, scope });
      await svc.purchasePackage('u1', { packageId: 'p1' } as never);
      expect(payments.initiateCreditTopup).toHaveBeenCalledTimes(1);
    }
  });

  it('confirmBazaarPurchase بسته‌ی STORE_AI_CREDIT را رد می‌کند و بازار صدا زده نمی‌شود', async () => {
    const { svc, payments } = makeService({
      ...base,
      scope: 'STORE_AI_CREDIT',
    });
    await expect(
      svc.confirmBazaarPurchase('u1', {
        packageId: 'p1',
        purchaseToken: 'tok',
      } as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(payments.confirmBazaarPurchase).not.toHaveBeenCalled();
  });

  it('confirmBazaarPurchase بسته‌ی NIVO_CAL_BAZAAR عمومی را می‌پذیرد', async () => {
    const { svc, payments } = makeService({ ...base, scope: 'NIVO_CAL_BAZAAR' });
    await svc.confirmBazaarPurchase('u1', {
      packageId: 'p1',
      purchaseToken: 'tok',
    } as never);
    expect(payments.confirmBazaarPurchase).toHaveBeenCalledTimes(1);
  });
});
