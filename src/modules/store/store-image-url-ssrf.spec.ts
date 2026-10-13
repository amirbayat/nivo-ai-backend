import { StoreService } from './store.service';

describe('2.6 — addProductImagesFromUrl: SSRF', () => {
  it('آدرس‌های داخلی/metadata دانلود نمی‌شوند و چیزی آپلود نمی‌شود', async () => {
    const svc = Object.create(StoreService.prototype) as StoreService;
    const uploadImage = jest.fn();
    const product = { id: 'p1', images: [] as string[] };
    Object.assign(svc, {
      getOwnedProduct: jest.fn().mockResolvedValue(product),
      storage: { uploadImage },
      prisma: { product: { update: jest.fn() } },
    });
    const result = await svc.addProductImagesFromUrl('s', 'st', 'p1', [
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:3000/api/v1/health',
      'http://localhost/x.png',
      'file:///etc/passwd',
    ]);
    expect(result).toBe(product);
    expect(uploadImage).not.toHaveBeenCalled();
  });
});
