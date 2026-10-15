import { ConflictException } from '@nestjs/common';
import { StoreService } from './store.service';

function build(existingRealStores: number) {
  const prisma = {
    store: {
      count: jest.fn().mockResolvedValue(existingRealStores),
      create: jest.fn(async ({ data }) => ({ id: 'new', ...data })),
    },
  };
  const svc = Object.create(StoreService.prototype) as StoreService;
  Object.assign(svc, {
    prisma,
    isSlugAvailable: jest.fn().mockResolvedValue(true),
    assertBankCardPair: jest.fn(),
  });
  return { svc, prisma };
}

describe('StoreService.create one store per seller [R3.5 / D-1]', () => {
  it('فروشنده‌ای که فروشگاه واقعی دارد ← 409 و ساخته نمی‌شود', async () => {
    const { svc, prisma } = build(1);
    await expect(
      svc.create('seller-1', { name: 'x', slug: 'x' } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.store.create).not.toHaveBeenCalled();
    expect(prisma.store.count.mock.calls[0][0].where).toEqual({
      sellerId: 'seller-1',
      isDemo: false,
    });
  });
});
