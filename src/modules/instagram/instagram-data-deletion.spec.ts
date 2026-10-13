import * as crypto from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { InstagramController } from './instagram.controller';
import { InstagramService } from './instagram.service';
import { parseSignedRequest } from './instagram-signed-request.util';

// PRD-nivo-sales-unified.md تسک 0.1 — حذف داده‌ی اینستاگرام فقط با signed_request امضاشده
const SECRET = 'app-secret';
const sign = (payload: object, secret = SECRET) => {
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(p).digest('base64url');
  return `${sig}.${p}`;
};

describe('parseSignedRequest [0.1]', () => {
  it('امضای درست → user_id', () => {
    expect(
      parseSignedRequest(
        sign({ user_id: '123', algorithm: 'HMAC-SHA256' }),
        SECRET,
      ),
    ).toEqual({ user_id: '123' });
  });
  it.each([
    ['undefined', undefined],
    ['خالی', ''],
    ['بدون نقطه', 'abc'],
    ['امضای غلط', sign({ user_id: '1' }, 'other-secret')],
    [
      'payload دستکاری‌شده',
      `${sign({ user_id: '1' }).split('.')[0]}.${Buffer.from('{"user_id":"2"}').toString('base64url')}`,
    ],
    ['بدون user_id', sign({ foo: 1 })],
    ['الگوریتم غلط', sign({ user_id: '1', algorithm: 'none' })],
  ])('%s → null', (_n, v) => {
    expect(parseSignedRequest(v, SECRET)).toBeNull();
  });
  it('بدون app secret → null', () => {
    expect(parseSignedRequest(sign({ user_id: '1' }), undefined)).toBeNull();
  });
});

describe('InstagramController.dataDeletion [0.1]', () => {
  const make = () => {
    const instagram = { deleteStoreInstagramData: jest.fn() };
    const config = { get: () => SECRET };
    const ctrl = new InstagramController(instagram as never, config as never);
    return { ctrl, instagram };
  };
  it('بدون signed_request (فقط user_id خام) → 400 و بدون حذف', async () => {
    const { ctrl, instagram } = make();
    await expect(
      ctrl.dataDeletion({ user_id: 'victim' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(instagram.deleteStoreInstagramData).not.toHaveBeenCalled();
  });
  it('امضای غلط → 400 و بدون حذف', async () => {
    const { ctrl, instagram } = make();
    await expect(
      ctrl.dataDeletion({ signed_request: sign({ user_id: 'victim' }, 'bad') }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(instagram.deleteStoreInstagramData).not.toHaveBeenCalled();
  });
  it('امضای معتبر → حذف با user_id تاییدشده', async () => {
    const { ctrl, instagram } = make();
    const r = await ctrl.dataDeletion({
      signed_request: sign({ user_id: 'biz1' }),
      user_id: 'ignored-body-value',
    });
    expect(instagram.deleteStoreInstagramData).toHaveBeenCalledWith('biz1');
    expect(r.confirmation_code).toMatch(/^del_/);
  });
});

describe('InstagramService.deleteStoreInstagramData [0.1]', () => {
  it('سفارش‌ها/مشتری‌ها حذف نمی‌شوند؛ PII ناشناس می‌شود', async () => {
    const tx: unknown[] = [];
    const prisma = {
      store: {
        findUnique: jest.fn().mockResolvedValue({ id: 'st1' }),
        update: jest.fn((a) => ({ op: 'store.update', a })),
      },
      customer: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'c1', instagramPsid: 'psid1' }]),
        update: jest.fn((a) => ({ op: 'customer.update', a })),
        deleteMany: jest.fn(),
      },
      customerAddress: { deleteMany: jest.fn((a) => ({ op: 'addr.del', a })) },
      instagramAutomationRule: {
        deleteMany: jest.fn((a) => ({ op: 'rule.del', a })),
      },
      order: { deleteMany: jest.fn() },
      salesConversation: { deleteMany: jest.fn() },
      $transaction: jest.fn(async (ops: unknown[]) => void tx.push(...ops)),
    };
    const svc = Object.create(InstagramService.prototype) as InstagramService;
    Object.assign(svc, { prisma });
    await svc.deleteStoreInstagramData('biz1');

    expect(prisma.customer.deleteMany).not.toHaveBeenCalled();
    expect(prisma.order.deleteMany).not.toHaveBeenCalled();
    expect(prisma.salesConversation.deleteMany).not.toHaveBeenCalled();
    const upd = prisma.customer.update.mock.calls[0][0];
    expect(upd.data.phone).toBeNull();
    expect(upd.data.fullName).toBeNull();
    expect(upd.data.instagramPsid).toMatch(/^anon_[0-9a-f]{32}$/);
    expect(upd.data.instagramPsid).not.toContain('psid1');
    expect(prisma.customerAddress.deleteMany).toHaveBeenCalled();
  });
});
