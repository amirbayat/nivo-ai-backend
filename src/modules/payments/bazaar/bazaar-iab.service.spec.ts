import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ConfirmBazaarPurchaseDto } from '../../credits/dto/confirm-bazaar-purchase.dto';
import { BazaarIabService } from './bazaar-iab.service';

// PRD-nivo-sales-unified.md تسک 0.13d — path-traversal در purchaseToken کافه‌بازار
describe('Bazaar purchaseToken safety [0.13d]', () => {
  const dtoErrors = async (purchaseToken: string) =>
    validate(
      plainToInstance(ConfirmBazaarPurchaseDto, {
        packageId: '3f2b8c1e-6a3b-4a43-9f43-0c9d6f0f7a11',
        purchaseToken,
      }),
    );

  it.each([
    '../../SKU_CHEAP/purchases/REAL',
    'abc/def',
    '..',
    'a..b',
    'tok en',
    'tok?x=1',
    'tok%2e%2e',
  ])('DTO توکن ناامن «%s» را رد می‌کند', async (t) => {
    expect((await dtoErrors(t)).length).toBeGreaterThan(0);
  });

  it('DTO توکن عادی بازار را قبول می‌کند', async () => {
    expect(await dtoErrors('Ab3-xYz_9.k')).toHaveLength(0);
  });

  describe('BazaarIabService.validatePurchase', () => {
    const config = {
      get: (k: string) =>
        k === 'CAFEBAZAAR_PISHKHAN_API_SECRET' ? 'secret' : undefined,
    };
    let fetchMock: jest.Mock;
    beforeEach(() => {
      fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ purchaseState: 0, consumptionState: 0 }),
      });
      (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    });

    it('توکن حاوی / یا .. بدون هیچ درخواستی به بازار رد می‌شود', async () => {
      const svc = new BazaarIabService(config as never);
      const r = await svc.validatePurchase('SKU', '../../SKU_CHEAP/purchases/X');
      expect(r.valid).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('productId ناامن هم رد می‌شود', async () => {
      const svc = new BazaarIabService(config as never);
      const r = await svc.validatePurchase('../x', 'TOKEN');
      expect(r.valid).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('توکن امن درخواست می‌زند و URL سالم دارد', async () => {
      const svc = new BazaarIabService(config as never);
      const r = await svc.validatePurchase('SKU_1', 'TOK-1');
      expect(r.valid).toBe(true);
      expect(fetchMock.mock.calls[0][0]).toContain(
        '/inapp/SKU_1/purchases/TOK-1/',
      );
    });
  });
});
