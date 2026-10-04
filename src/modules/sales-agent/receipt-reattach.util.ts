import { PrismaService } from '../../prisma/prisma.service';

// docs/PRD-seller-panel-order-chat-linking.md بخش ۲.۲ — مشترک بین کانال وب
// (sales-agent.service.ts) و تلگرام (telegram.service.ts) تا هر دو کانال رفتار یکسان داشته
// باشند. فیدبک کاربر — این دقیقاً همان باگی بود که این فایل برایش ساخته شد: وقتی اول فقط در
// sales-agent.service.ts اضافه شده بود، عکس خریدارِ muted در تلگرام همچنان هیچ‌وقت روی سفارش
// نمی‌نشست، چون handlePhoto تلگرام یک کپی جدا از همین منطق نداشت و حتی لاگ هم نمی‌شد.
export async function reattachReceiptIfOrderOpen(
  prisma: PrismaService,
  conversationId: string,
  imageKey: string,
): Promise<boolean> {
  const order = await prisma.order.findUnique({
    where: { conversationId },
    select: { id: true, status: true },
  });
  if (!order || order.status === 'APPROVED') return false;

  await prisma.order.update({
    where: { id: order.id },
    data: {
      receiptImageKey: imageKey,
      ...(order.status === 'REJECTED'
        ? { status: 'RECEIPT_SUBMITTED', rejectReason: null }
        : {}),
    },
  });
  return true;
}
