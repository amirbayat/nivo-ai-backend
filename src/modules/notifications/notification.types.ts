// docs/PRD-nivo-sales-unified.md 3.6 / D-6 — قالب‌ها و کانال‌های NotificationService.
// فقط قالب‌هایی که تا گام ۳ ساخته شده‌اند؛ بقیه‌ی فهرست 3.6 (RECEIPT_RECEIVED، SELLER_*،
// REFUND_*) با تسک‌های خودشان اضافه می‌شوند.
export type BuyerNotificationTemplate =
  | 'ORDER_PLACED'
  | 'PAYMENT_REMINDER'
  | 'ORDER_APPROVED'
  | 'ORDER_SHIPPED'
  | 'ORDER_REJECTED'
  | 'ORDER_CANCELLED'
  | 'REFUND_DESTINATION_REQUEST'
  | 'REFUND_DONE'
  | 'RECEIPT_AMOUNT_MISMATCH'
  | 'DELIVERY_CHECK'
  | 'BACK_IN_STOCK';

export type BuyerChannel = 'CHAT' | 'SMS';

// هر قالب از کدام کانال‌ها می‌رود. ORDER_PLACED فقط SMS است چون کارت پرداخت خودِ پیام چت است.
export const TEMPLATE_CHANNELS: Readonly<
  Record<BuyerNotificationTemplate, readonly BuyerChannel[]>
> = {
  ORDER_PLACED: ['SMS'],
  PAYMENT_REMINDER: ['CHAT', 'SMS'],
  ORDER_APPROVED: ['CHAT', 'SMS'],
  ORDER_SHIPPED: ['CHAT', 'SMS'],
  ORDER_REJECTED: ['CHAT', 'SMS'],
  ORDER_CANCELLED: ['CHAT', 'SMS'],
  REFUND_DESTINATION_REQUEST: ['CHAT', 'SMS'],
  REFUND_DONE: ['CHAT', 'SMS'],
  RECEIPT_AMOUNT_MISMATCH: ['CHAT'],
  DELIVERY_CHECK: ['CHAT', 'SMS'],
  BACK_IN_STOCK: ['CHAT', 'SMS'],
};

export type BuyerNotificationData = {
  orderId: string;
  reason?: string | null;
  carrier?: string | null;
  trackingCode?: string | null;
  hoursLeft?: number;
  refundAmountToman?: number | null;
  refundId?: string | null;
  paidRef?: string | null;
  destinationMasked?: string | null;
  receiptAmountToman?: number | null;
  orderAmountToman?: number | null;
  productName?: string;
  conversationId?: string;
  productUrl?: string;
};

export type NotifyBuyerInput = {
  to: { customerId: string };
  template: BuyerNotificationTemplate;
  // dedupe: template + entityId (+ کانال) در ۱۰ دقیقه
  entityId: string;
  data: BuyerNotificationData;
  // Longer than the 10-minute channel dedupe. Cron passes that still match
  // (delivery nudge, refund reminder) must set this or they resend every run.
  dedupe?: { key: string; ttlSeconds: number };
};

export type NotificationJob = {
  template: BuyerNotificationTemplate;
  channel: BuyerChannel;
  customerId: string;
  entityId: string;
  data: BuyerNotificationData;
};

export const NOTIFICATION_QUEUE = 'order-notifications';
