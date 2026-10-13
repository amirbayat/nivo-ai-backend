import { OrderStatus } from '@prisma/client';
import {
  ORDER_TRANSITIONS,
  allowedFrom,
  canTransition,
  holdsStock,
} from './order-state.machine';

const ALL: OrderStatus[] = [
  'PENDING_PAYMENT',
  'RECEIPT_SUBMITTED',
  'APPROVED',
  'REJECTED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
];

describe('order state machine [3.2 / D-3]', () => {
  it('مسیر اصلی D-3', () => {
    expect(canTransition('PENDING_PAYMENT', 'RECEIPT_SUBMITTED')).toBe(true);
    expect(canTransition('RECEIPT_SUBMITTED', 'APPROVED')).toBe(true);
    expect(canTransition('APPROVED', 'SHIPPED')).toBe(true);
    expect(canTransition('SHIPPED', 'DELIVERED')).toBe(true);
  });

  it('از هر وضعیت پیش از SHIPPED → REJECTED/CANCELLED', () => {
    for (const from of ['PENDING_PAYMENT', 'RECEIPT_SUBMITTED', 'APPROVED'] as const) {
      expect(canTransition(from, 'REJECTED')).toBe(true);
      expect(canTransition(from, 'CANCELLED')).toBe(true);
    }
  });

  it('بعد از SHIPPED رد/لغو ممکن نیست؛ ship روی PENDING/REJECTED رد می‌شود', () => {
    expect(canTransition('SHIPPED', 'REJECTED')).toBe(false);
    expect(canTransition('SHIPPED', 'CANCELLED')).toBe(false);
    expect(canTransition('PENDING_PAYMENT', 'SHIPPED')).toBe(false);
    expect(canTransition('REJECTED', 'SHIPPED')).toBe(false);
    expect(canTransition('RECEIPT_SUBMITTED', 'SHIPPED')).toBe(false);
  });

  it('approve یک SHIPPED/DELIVERED/CANCELLED ممکن نیست (باگ اصلی 3.2)', () => {
    expect(canTransition('SHIPPED', 'APPROVED')).toBe(false);
    expect(canTransition('DELIVERED', 'APPROVED')).toBe(false);
    expect(canTransition('CANCELLED', 'APPROVED')).toBe(false);
  });

  it('انتقال‌های برگشتیِ رفتار موجود: REJECTED → APPROVED / RECEIPT_SUBMITTED', () => {
    expect(canTransition('REJECTED', 'APPROVED')).toBe(true);
    expect(canTransition('REJECTED', 'RECEIPT_SUBMITTED')).toBe(true);
  });

  it('DELIVERED و CANCELLED پایانی‌اند و خودبه‌خود انتقال ندارند', () => {
    expect(ORDER_TRANSITIONS.DELIVERED).toEqual([]);
    expect(ORDER_TRANSITIONS.CANCELLED).toEqual([]);
    for (const s of ALL) expect(canTransition(s, s)).toBe(false);
  });

  it('allowedFrom با جدول سازگار است', () => {
    expect(allowedFrom('APPROVED').sort()).toEqual(
      ['PENDING_PAYMENT', 'RECEIPT_SUBMITTED', 'REJECTED'].sort(),
    );
    expect(allowedFrom('DELIVERED')).toEqual(['SHIPPED']);
  });

  it('موجودی فقط در APPROVED/SHIPPED/DELIVERED کم‌شده است', () => {
    expect(ALL.filter(holdsStock).sort()).toEqual(
      ['APPROVED', 'SHIPPED', 'DELIVERED'].sort(),
    );
  });
});
