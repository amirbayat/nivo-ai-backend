import { MarketplaceService } from './marketplace.service';

describe('MarketplaceService.listActiveStores [QA-2]', () => {
  it('filters to real stores with at least one ACTIVE product that has an image, logo stores first', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = new MarketplaceService({ store: { findMany } } as never);
    await svc.listActiveStores();
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      status: 'ACTIVE',
      leadCaptureOnly: false,
      isDemo: false,
      isDemoTemplate: false,
      products: {
        some: { status: 'ACTIVE', NOT: { images: { isEmpty: true } } },
      },
    });
    expect(args.orderBy[0]).toEqual({
      logoImageKey: { sort: 'asc', nulls: 'last' },
    });
  });
});
