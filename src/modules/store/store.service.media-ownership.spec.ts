import { NotFoundException } from '@nestjs/common';
import { StoreService } from './store.service';

// PRD-nivo-sales-unified.md تسک 0.13a — فروشنده نباید فایلی را که جزو images/videos همین
// محصول نیست از باکت حذف کند.
describe('StoreService — media delete ownership [0.13a]', () => {
  const makeService = (product: Record<string, unknown>) => {
    const storage = { deleteObject: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      product: { update: jest.fn().mockResolvedValue({}) },
    };
    const svc = Object.create(StoreService.prototype) as StoreService;
    Object.assign(svc, {
      storage,
      prisma,
      getOwnedProduct: jest.fn().mockResolvedValue(product),
    });
    return { svc, storage, prisma };
  };

  it('removeProductImage: کلید بیگانه → 404 و بدون حذف', async () => {
    const { svc, storage, prisma } = makeService({ images: ['mine.jpg'] });
    await expect(
      svc.removeProductImage('s', 'st', 'p', 'other-store/receipt.jpg'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('removeProductImage: کلید خود محصول حذف می‌شود', async () => {
    const { svc, storage, prisma } = makeService({
      images: ['mine.jpg', 'b.jpg'],
    });
    await svc.removeProductImage('s', 'st', 'p', 'mine.jpg');
    expect(storage.deleteObject).toHaveBeenCalledWith('mine.jpg');
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { images: ['b.jpg'] } }),
    );
  });

  it('removeProductVideo: کلید بیگانه → 404 و بدون حذف', async () => {
    const { svc, storage } = makeService({
      videos: [{ key: 'v1.mp4', durationSec: 5 }],
    });
    await expect(
      svc.removeProductVideo('s', 'st', 'p', 'foreign.mp4'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('removeProductVideo: کلید خود محصول حذف می‌شود', async () => {
    const { svc, storage } = makeService({
      videos: [{ key: 'v1.mp4', durationSec: 5 }],
    });
    await svc.removeProductVideo('s', 'st', 'p', 'v1.mp4');
    expect(storage.deleteObject).toHaveBeenCalledWith('v1.mp4');
  });
});
