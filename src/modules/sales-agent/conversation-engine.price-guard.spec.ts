import { ConversationEngineService } from './conversation-engine.service';
import { buildCorrectiveInstruction } from './sales-machine/reply-validator';
import { fa } from '../../i18n/fa';

// R1.4 — گارد قیمت: مبلغ غیرمجاز ← جمله حذف + «قیمت دقیق روی کارت»؛ ProductEvent و شمارش retry
describe('price guard [R1.4]', () => {
  const build = () => {
    const events: { data: { name: string; props: unknown } }[] = [];
    const prisma = {
      productEvent: {
        create: jest.fn(async (arg: { data: { name: string; props: unknown } }) => {
          events.push(arg);
        }),
      },
    };
    const eng = Object.create(ConversationEngineService.prototype) as unknown as {
      applyPriceGuard: (c: unknown, t: string, a: Set<number>, r: number) => Promise<string>;
    };
    Object.assign(eng, { prisma, logger: { warn: jest.fn() } });
    return { eng, events };
  };
  const conversation = { id: 'c1', storeId: 's1' };

  it('مبلغ غلط (بعد از retry) ← جمله حذف می‌شود و رویداد با retries=1 ثبت می‌شود', async () => {
    const { eng, events } = build();
    const out = await eng.applyPriceGuard(
      conversation,
      'کفش خوبیه. قیمتش ۳۹۰ هزار تومانه. موجوده.',
      new Set([450_000]),
      1,
    );
    expect(out).not.toContain('۳۹۰');
    expect(out).toContain('کفش خوبیه.');
    expect(out.endsWith(fa.salesAgent.priceSeeCard)).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].data.name).toBe('price_guard_triggered');
    expect(events[0].data.props).toEqual({ retries: 1, stripped: true });
  });

  it('retry موفق بوده (مبلغ مجاز) ← متن دست‌نخورده، فقط retries ثبت می‌شود', async () => {
    const { eng, events } = build();
    const out = await eng.applyPriceGuard(
      conversation,
      'قیمتش ۴۵۰ هزار تومانه.',
      new Set([450_000]),
      1,
    );
    expect(out).toBe('قیمتش ۴۵۰ هزار تومانه.');
    expect(events[0].data.props).toEqual({ retries: 1, stripped: false });
  });

  it('بدون مبلغ و بدون retry ← هیچ رویدادی نیست', async () => {
    const { eng, events } = build();
    const out = await eng.applyPriceGuard(conversation, 'سلام، چطور کمک کنم؟', new Set(), 0);
    expect(out).toBe('سلام، چطور کمک کنم؟');
    expect(events).toHaveLength(0);
  });

  it('پیام retry اصلاحی مبلغ را نام می‌برد', () => {
    expect(buildCorrectiveInstruction([{ code: 'SUSPICIOUS_PRICE', amounts: [390000] }])).toContain(
      'مبلغ 390000 در داده نیست؛ فقط از قیمت‌های ابزار استفاده کن',
    );
  });
});
