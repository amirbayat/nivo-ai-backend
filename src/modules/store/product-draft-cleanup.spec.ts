import { ProductEnrichmentReminderService } from './product-enrichment-reminder.service';

describe('cleanupEmptyDrafts [SP-3]', () => {
  it('only deletes old DRAFTs with no name, images, videos or variants', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 3 });
    const svc = new ProductEnrichmentReminderService({ product: { deleteMany } } as never, {} as never);
    const now = new Date('2026-10-16T12:00:00Z');
    await expect(svc.cleanupEmptyDrafts(now)).resolves.toBe(3);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        status: 'DRAFT',
        name: '',
        images: { isEmpty: true },
        videos: { equals: [] },
        variants: { none: {} },
        createdAt: { lt: new Date('2026-10-15T12:00:00Z') },
      },
    });
  });
});
