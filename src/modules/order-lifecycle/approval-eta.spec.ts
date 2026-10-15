import { approvalEtaLabel } from './order-ops.service';

describe('approvalEtaLabel [F28]', () => {
  it('reads the median from one query', async () => {
    const queryRaw = jest.fn(async () => [{ samples: 8, median_seconds: 7200 }]);
    const findFirst = jest.fn();
    const prisma = {
      $queryRaw: queryRaw,
      orderStatusEvent: { findFirst, findMany: jest.fn() },
    };
    const label = await approvalEtaLabel(prisma as never, 'eta-store-median');
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(findFirst).not.toHaveBeenCalled();
    expect(label).toBe('حدود ۲ ساعت');
  });

  it('keeps the fallback when there are too few approvals', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => [{ samples: 2, median_seconds: 7200 }]),
    };
    const label = await approvalEtaLabel(prisma as never, 'eta-store-few');
    expect(label).toBe('چند ساعت');
  });
});
