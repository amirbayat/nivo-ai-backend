jest.mock('./telegram.service', () => ({ TelegramService: class {} }));
import { ForbiddenException } from '@nestjs/common';
import { TelegramController } from './telegram.controller';
import { InstagramService } from '../instagram/instagram.service';

// PRD-nivo-sales-unified.md تسک 0.5 — پاسخ فوری، dedupe روی update_id/mid، پردازش در صف
describe('TelegramController webhook [0.5]', () => {
  const build = (verify = true) => {
    const seen = new Set<string>();
    const redis = {
      set: jest.fn(async (k: string) => {
        if (seen.has(k)) return null;
        seen.add(k);
        return 'OK';
      }),
    };
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const telegram = {
      verifySecret: jest.fn().mockReturnValue(verify),
      handleUpdate: jest.fn(() => new Promise(() => undefined)), // هرگز تمام نمی‌شود
    };
    const ctrl = new TelegramController(
      telegram as never,
      redis as never,
      queue as never,
    );
    return { ctrl, queue, telegram };
  };

  it('پاسخ فوری است و handleUpdate را await نمی‌کند (فقط صف)', async () => {
    const { ctrl, queue, telegram } = build();
    const r = await ctrl.webhook({ update_id: 1 } as never, 's');
    expect(r).toEqual({ ok: true });
    expect(telegram.handleUpdate).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][2]).toMatchObject({
      jobId: 'tg-1',
      attempts: 1,
    });
  });

  it('ارسال تکراری همان update_id → فقط یک job', async () => {
    const { ctrl, queue } = build();
    await ctrl.webhook({ update_id: 7 } as never, 's');
    await ctrl.webhook({ update_id: 7 } as never, 's');
    await ctrl.webhook({ update_id: 8 } as never, 's');
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('secret غلط → 403 و بدون صف', async () => {
    const { ctrl, queue } = build(false);
    await expect(
      ctrl.webhook({ update_id: 1 } as never, 'bad'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('InstagramService dedupe [0.5]', () => {
  it('همان mid دوبار پردازش نمی‌شود', async () => {
    const seen = new Set<string>();
    const redis = {
      set: jest.fn(async (k: string) => {
        if (seen.has(k)) return null;
        seen.add(k);
        return 'OK';
      }),
    };
    const svc = Object.create(InstagramService.prototype) as InstagramService;
    const dispatch = jest.fn();
    Object.assign(svc, { redis, resolveAndDispatch: dispatch });
    const entry = {
      id: 'biz',
      messaging: [
        { sender: { id: 'u1' }, message: { mid: 'm1', text: 'سلام' } },
      ],
    };
    const handle = (
      svc as unknown as {
        handleEntry: (e: unknown) => Promise<void>;
      }
    ).handleEntry.bind(svc);
    await handle(entry);
    await handle(entry);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
