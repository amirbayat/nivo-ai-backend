import { OrderStatus } from '@prisma/client';

// docs/PRD-nivo-sales-unified.md D-3 / 3.2 — جدول انتقال‌های مجاز سفارش (منطق خالص، بدون DB).
// PENDING_PAYMENT → RECEIPT_SUBMITTED → APPROVED → SHIPPED → DELIVERED؛ از هر وضعیت پیش از
// SHIPPED → REJECTED/CANCELLED. دو انتقال «برگشتی» از رفتار موجود نگه داشته شده‌اند:
//  - REJECTED → APPROVED (فروشنده بعد از رد اشتباهی دوباره تایید می‌کند — فیدبک کاربر)
//  - REJECTED → RECEIPT_SUBMITTED (خریدار بعد از رد، رسید تازه می‌فرستد — receipt-reattach)
//  - PENDING_PAYMENT → APPROVED (فروشنده بدون رسید تایید می‌کند؛ مثلاً پرداخت حضوری/تلفنی)
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_PAYMENT: ['RECEIPT_SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'],
  RECEIPT_SUBMITTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['SHIPPED', 'REJECTED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  REJECTED: ['APPROVED', 'RECEIPT_SUBMITTED'],
  DELIVERED: [],
  CANCELLED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

// وضعیت‌هایی که اجازه‌ی رسیدن به `to` را دارند (برای updateMany where اتمیک)
export function allowedFrom(to: OrderStatus): OrderStatus[] {
  return (Object.keys(ORDER_TRANSITIONS) as OrderStatus[]).filter((from) =>
    canTransition(from, to),
  );
}

// موجودی انبار فقط در APPROVED/SHIPPED/DELIVERED کم‌شده است
const STOCK_HELD: ReadonlySet<OrderStatus> = new Set([
  'APPROVED',
  'SHIPPED',
  'DELIVERED',
]);

export function holdsStock(status: OrderStatus): boolean {
  return STOCK_HELD.has(status);
}
