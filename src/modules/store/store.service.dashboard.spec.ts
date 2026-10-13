import { StoreService } from './store.service';
import {
  addTehranDays,
  startOfTehranDay,
  tehranDateString,
} from '../../common/utils/tehran-time.util';

// PRD-nivo-sales-unified.md تسک‌های 0.7 و 0.13k
describe('Tehran day boundaries [0.13k]', () => {
  it('۰۰:۱۰ تهران = ۲۰:۴۰ UTC روز قبل؛ شروع روز تهران ۲۰:۳۰ UTC', () => {
    // 2026-10-13T20:40:00Z = 2026-10-14 00:10 تهران
    const d = new Date('2026-10-13T20:40:00Z');
    expect(startOfTehranDay(d).toISOString()).toBe('2026-10-13T20:30:00.000Z');
    expect(tehranDateString(startOfTehranDay(d))).toBe('2026-10-14');
  });
  it('۲۳:۵۰ تهران هنوز همان روز است', () => {
    const d = new Date('2026-10-14T20:20:00Z'); // 23:50 تهران ۱۴ ام
    expect(tehranDateString(startOfTehranDay(d))).toBe('2026-10-14');
  });
  it('addTehranDays', () => {
    const s = startOfTehranDay(new Date('2026-10-14T10:00:00Z'));
    expect(tehranDateString(addTehranDays(s, -1))).toBe('2026-10-13');
  });
});

describe('StoreService.getDashboard [0.7][0.13k]', () => {
  const build = (orders: Record<string, unknown>[]) => {
    const findMany = jest.fn().mockResolvedValue(orders);
    const prisma = {
      order: { findMany, groupBy: jest.fn().mockResolvedValue([]) },
    };
    const svc = Object.create(StoreService.prototype) as StoreService;
    Object.assign(svc, { prisma, getOwned: jest.fn() });
    return { svc, findMany };
  };

  it('کوئری هر دو وضعیت APPROVED و SHIPPED را می‌شمارد', async () => {
    const { svc, findMany } = build([]);
    await svc.getDashboard('s', 'st');
    expect(findMany.mock.calls[0][0].where.status.in).toEqual(
      expect.arrayContaining(['APPROVED', 'SHIPPED']),
    );
  });

  it('درآمد بر اساس approvedAt است، نه createdAt', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 20 * 24 * 3600 * 1000);
    const { svc } = build([
      {
        totalAmount: 500,
        createdAt: old, // ماه پیش ثبت شد
        approvedAt: now, // ولی همین الان تایید شد
        items: [],
        conversation: { customerId: 'c1' },
      },
    ]);
    const r = await svc.getDashboard('s', 'st');
    expect(r.revenueTodayToman).toBe(500);
  });

  it('سفارش بدون approvedAt (قدیمی) به createdAt برمی‌گردد', async () => {
    const { svc } = build([
      {
        totalAmount: 700,
        createdAt: new Date(),
        approvedAt: null,
        items: [],
        conversation: { customerId: 'c1' },
      },
    ]);
    expect((await svc.getDashboard('s', 'st')).revenueTodayToman).toBe(700);
  });
});
