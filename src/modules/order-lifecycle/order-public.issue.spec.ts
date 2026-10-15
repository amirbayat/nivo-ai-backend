import { BadRequestException } from '@nestjs/common';
import { OrderPublicService } from './order-public.service';

describe('reportIssue [F20]', () => {
  const build = (status: string, open: { id: string; status: string } | null) => {
    const create = jest.fn(async () => ({ id: 'new-issue', status: 'OPEN' }));
    const notifySeller = jest.fn(async () => undefined);
    const svc = Object.create(OrderPublicService.prototype) as OrderPublicService;
    Object.assign(svc, {
      guard: async () => 'o1',
      prisma: {
        order: {
          findUnique: async () => ({
            id: 'o1',
            storeId: 's1',
            status,
            orderCode: 'NVK7M2QX',
          }),
        },
        orderIssue: {
          findFirst: async () => open,
          create,
        },
      },
      notifications: { notifySeller },
    });
    return { svc, create, notifySeller };
  };

  it('rejects a problem report before the order is approved', async () => {
    const { svc, create, notifySeller } = build('RECEIPT_SUBMITTED', null);
    await expect(svc.reportIssue('NVK7M2QX', 'tok', '1.1.1.1', 'DAMAGED')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(create).not.toHaveBeenCalled();
    expect(notifySeller).not.toHaveBeenCalled();
  });

  it('returns the open issue instead of opening a second one', async () => {
    const { svc, create, notifySeller } = build('SHIPPED', { id: 'open-1', status: 'OPEN' });
    const result = await svc.reportIssue('NVK7M2QX', 'tok', '1.1.1.1', 'DAMAGED', 'box');
    expect(result).toEqual({ id: 'open-1', status: 'OPEN' });
    expect(create).not.toHaveBeenCalled();
    expect(notifySeller).not.toHaveBeenCalled();
  });

  it('opens one issue after approval', async () => {
    const { svc, create, notifySeller } = build('APPROVED', null);
    const result = await svc.reportIssue('NVK7M2QX', 'tok', '1.1.1.1', 'DAMAGED');
    expect(result).toEqual({ id: 'new-issue', status: 'OPEN' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(notifySeller).toHaveBeenCalledTimes(1);
  });
});
