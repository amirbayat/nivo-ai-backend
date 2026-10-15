import { Prisma } from '@prisma/client';
import { StockAlertService } from './stock-alert.service';

function service(prisma: object, notifications: object) {
  const svc = Object.create(StockAlertService.prototype) as StockAlertService;
  Object.assign(svc, { prisma, notifications });
  return svc;
}

describe('StockAlertService', () => {
  it('returns the existing alert when a second open row hits the unique index', async () => {
    const prisma = {
      product: { findFirst: async () => ({ id: 'p1', stock: 0 }) },
      customer: { findUnique: async () => ({ phone: '09120000000', phoneVerifiedAt: new Date() }) },
      productStockAlert: {
        findFirst: async () => null,
        create: async () => {
          throw new Prisma.PrismaClientKnownRequestError('dup', {
            code: 'P2002',
            clientVersion: 'test',
          });
        },
      },
    };
    const svc = service(prisma, { notifyBuyer: jest.fn() });
    await expect(
      svc.subscribe({
        storeId: 's1',
        productId: 'p1',
        customerId: 'c1',
        conversationId: 'cv1',
      }),
    ).resolves.toEqual({ status: 'subscribed' });
  });

  it('texts only the first 200 waiters and chats the rest', async () => {
    const alerts = Array.from({ length: 201 }, (_, i) => ({
      id: `a${i}`,
      customerId: `c${i}`,
      conversationId: `cv${i}`,
      productId: 'p1',
      product: { name: 'کفش', store: { slug: 'shop' } },
    }));
    const notifyBuyer = jest.fn(async (..._args: unknown[]) => undefined);
    const prisma = {
      productStockAlert: {
        findMany: async () => alerts,
        update: async () => ({}),
      },
    };
    const svc = service(prisma, { notifyBuyer });
    await svc.notifyRestocked([
      { productId: 'p1', variantId: null, previous: 0, next: 3 },
    ]);
    expect(notifyBuyer).toHaveBeenCalledTimes(201);
    const last = notifyBuyer.mock.calls[200][0] as { channels?: string[] };
    const first = notifyBuyer.mock.calls[0][0] as { channels?: string[] };
    expect(first.channels).toBeUndefined();
    expect(last.channels).toEqual(['CHAT']);
  });
});
