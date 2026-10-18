import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

const logger = new Logger('touchConversation');

export type TouchKind = 'CUSTOMER' | 'AGENT' | 'SELLER';

// docs/PRD-seller-conversations-inbox.md §۴.۲ — هر جا CUSTOMER_MESSAGE/AGENT_REPLY/SELLER_MESSAGE
// ساخته می‌شود این را صدا بزن تا مرتب‌سازی لیست «گفتگوها» و شمارنده‌ی خوانده‌نشده درست بماند.
// شکستش هرگز نباید چت را از کار بیندازد (فقط لاگ می‌شود).
export async function touchConversation(
  prisma: Pick<PrismaClient, 'salesConversation'>,
  conversationId: string,
  kind: TouchKind,
  at: Date = new Date(),
): Promise<void> {
  try {
    await prisma.salesConversation.updateMany({
      where: { id: conversationId },
      data: {
        lastMessageAt: at,
        ...(kind === 'CUSTOMER' ? { lastCustomerMessageAt: at } : {}),
      },
    });
  } catch (err) {
    logger.warn(
      `touch failed (conversation=${conversationId}): ${(err as Error).message}`,
    );
  }
}
