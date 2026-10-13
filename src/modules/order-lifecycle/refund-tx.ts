import { BadRequestException } from '@nestjs/common';
import { Prisma, RefundReason } from '@prisma/client';
import { fa } from '../../i18n/fa';

// Creates one refund inside the caller's transaction. Amount is the remainder
// unless the seller passed a smaller figure. Never exceeds what was paid.
export async function insertRefund(
  tx: Prisma.TransactionClient,
  order: { id: string; storeId: string; totalAmount: number },
  reason: RefundReason,
  actor: 'SYSTEM' | 'SELLER',
  amountToman?: number | null,
  note?: string | null,
): Promise<{ id: string; amountToman: number } | null> {
  const agg = await tx.orderRefund.aggregate({
    where: { orderId: order.id, status: { not: 'CANCELLED' } },
    _sum: { amountToman: true },
  });
  const used = agg._sum.amountToman ?? 0;
  const remaining = Math.max(0, order.totalAmount - used);
  if (remaining <= 0) return null;
  const amount = amountToman == null ? remaining : amountToman;
  if (!Number.isInteger(amount) || amount < 1 || amount > remaining) {
    throw new BadRequestException(fa.order.refundAmountInvalid);
  }
  const row = await tx.orderRefund.create({
    data: {
      orderId: order.id,
      storeId: order.storeId,
      amountToman: amount,
      reason,
      note: note ?? null,
      status: 'AWAITING_DESTINATION',
      createdByActor: actor,
    },
  });
  return { id: row.id, amountToman: amount };
}
