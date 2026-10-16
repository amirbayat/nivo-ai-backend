import { BadRequestException } from '@nestjs/common';
import { StoreAdPlacementService } from './store-ad-placement.service';

// docs/PRD-fixes-after-buyer-redesign.md S2 — تبلیغ محصول غیرفعال، قبل از کسر اعتبار رد می‌شود
describe('purchaseProductPlacement status guard [FX-4 S2]', () => {
  it.each(['DRAFT', 'HIDDEN'])('%s product is rejected and nothing is charged', async (status) => {
    const debitFixedPrice = jest.fn();
    const svc = Object.create(StoreAdPlacementService.prototype) as Record<string, any>;
    Object.assign(svc, {
      storeService: { getOwnedProduct: jest.fn().mockResolvedValue({ id: 'p1', status }) },
      creditDeduction: { debitFixedPrice },
      prisma: { $transaction: jest.fn() },
    });
    await expect(svc.purchaseProductPlacement('u', 's1', 'p1', 7)).rejects.toBeInstanceOf(BadRequestException);
    expect(debitFixedPrice).not.toHaveBeenCalled();
    expect(svc.prisma.$transaction).not.toHaveBeenCalled();
  });
});
