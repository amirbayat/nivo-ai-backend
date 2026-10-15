import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StoreService } from './store.service';
import { UpdateStoreDto } from './dto/update-store.dto';

describe('UpdateStoreDto shipping days [R3.3]', () => {
  it('ارقام فارسی را می‌پذیرد', async () => {
    const dto = plainToInstance(UpdateStoreDto, {
      shippingDaysMin: '۲',
      shippingDaysMax: '۴',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.shippingDaysMin).toBe(2);
    expect(dto.shippingDaysMax).toBe(4);
  });
  it('اعشار و خارج از بازه رد می‌شود', async () => {
    const bad = plainToInstance(UpdateStoreDto, {
      shippingDaysMin: 1.5,
      shippingDaysMax: 99,
    });
    expect((await validate(bad)).length).toBeGreaterThan(0);
  });
});

describe('StoreService.update shipping days [R3.3]', () => {
  function build() {
    const prisma = {
      store: { update: jest.fn(async ({ data }) => ({ id: 's', ...data })) },
    };
    const svc = Object.create(StoreService.prototype) as StoreService;
    Object.assign(svc, {
      prisma,
      getOwned: jest.fn(async () => ({ id: 's', leadCaptureOnly: false })),
      changeLog: { logMany: jest.fn() },
    });
    return { svc, prisma };
  }
  it('min > max ← 400 و ذخیره نمی‌شود', async () => {
    const { svc, prisma } = build();
    await expect(
      svc.update('u', 's', { shippingDaysMin: 5, shippingDaysMax: 2 } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.store.update).not.toHaveBeenCalled();
  });
  it('فقط یکی ← 400', async () => {
    const { svc } = build();
    await expect(
      svc.update('u', 's', { shippingDaysMin: 2 } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('هر دو null ← پاک می‌شود', async () => {
    const { svc, prisma } = build();
    await svc.update('u', 's', {
      shippingDaysMin: null,
      shippingDaysMax: null,
    } as never);
    expect(prisma.store.update.mock.calls[0][0].data).toMatchObject({
      shippingDaysMin: null,
      shippingDaysMax: null,
    });
  });
});
