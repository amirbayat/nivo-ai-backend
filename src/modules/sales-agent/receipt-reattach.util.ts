import { PrismaService } from '../../prisma/prisma.service';
import type { OrderStateService } from '../order-lifecycle/order-state.service';

// docs/PRD-seller-panel-order-chat-linking.md بخش ۲.۲ — مشترک بین کانال وب
// (sales-agent.service.ts) و تلگرام (telegram.service.ts) تا هر دو کانال رفتار یکسان داشته
// باشند. فیدبک کاربر — این دقیقاً همان باگی بود که این فایل برایش ساخته شد: وقتی اول فقط در
// sales-agent.service.ts اضافه شده بود، عکس خریدارِ muted در تلگرام همچنان هیچ‌وقت روی سفارش
// نمی‌نشست، چون handlePhoto تلگرام یک کپی جدا از همین منطق نداشت و حتی لاگ هم نمی‌شد.
//
// 3.2 — فقط سفارش «باز» رسید می‌گیرد: PENDING_PAYMENT/RECEIPT_SUBMITTED (فقط کلید عکس عوض
// می‌شود)، REJECTED (از طریق ماشین وضعیت → RECEIPT_SUBMITTED). سفارش تاییدشده/ارسال‌شده/
// تحویل‌شده/لغوشده دیگر رسید نمی‌گیرد (قبلاً SHIPPED رسیدش بازنویسی می‌شد).
export async function reattachReceiptIfOrderOpen(
  prisma: PrismaService,
  orderState: OrderStateService,
  conversationId: string,
  imageKey: string,
  channel: 'WEB' | 'TELEGRAM' = 'WEB',
): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { conversationId },
    select: { id: true, status: true },
  });
  if (!order) return false;

  if (order.status === 'REJECTED') {
    const r = await orderState
      .transition({
        orderId: order.id,
        to: 'RECEIPT_SUBMITTED',
        actor: 'BUYER',
        channel,
        data: { receiptImageKey: imageKey, receiptType: 'IMAGE' },
      })
      .catch(() => null);
    return !!r;
  }
  if (
    order.status === 'PENDING_PAYMENT' ||
    order.status === 'RECEIPT_SUBMITTED'
  ) {
    await prisma.order.update({
      where: { id: order.id },
      data: { receiptImageKey: imageKey },
    });
    return true;
  }
  return false;
}
