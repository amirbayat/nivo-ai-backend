import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AnonFunnelEventService } from './anon-funnel-event.service';

// انتقال مکالمات anonymous به اکانت واقعی هنگام لاگین — idempotent (safe به‌عنوان no-op
// اگر قبلاً migrate شده یا clientToken اصلاً session نداشته باشد). ردیف‌های anonymous حذف
// نمی‌شوند (نگه‌داری برای آنالیز/QA ادمین) — فقط migratedConversationId ست می‌شود.
@Injectable()
export class AnonMigrationService {
  private readonly logger = new Logger(AnonMigrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly funnelEvents: AnonFunnelEventService,
  ) {}

  async migrateSessionToUser(
    clientToken: string,
    userId: string,
  ): Promise<void> {
    const session = await this.prisma.anonymousSession.findUnique({
      where: { clientToken },
      include: {
        conversations: {
          where: { migratedConversationId: null },
          include: { messages: { orderBy: { createdAt: 'asc' } } },
        },
      },
    });
    if (!session || session.migratedToUserId) return;

    let migratedUserMessageCount = 0;

    for (const conv of session.conversations) {
      await this.prisma.$transaction(async (tx) => {
        const created = await tx.conversation.create({
          data: {
            userId,
            title: conv.title,
            model: conv.model,
            totalTokens: conv.totalTokens,
            lastMessageAt: conv.lastMessageAt,
            createdAt: conv.createdAt,
          },
        });
        if (conv.messages.length) {
          await tx.message.createMany({
            data: conv.messages.map((m) => ({
              conversationId: created.id,
              userId,
              role: m.role,
              content: m.content,
              tokensInput: m.tokensInput,
              tokensOutput: m.tokensOutput,
              model: m.model,
              createdAt: m.createdAt,
            })),
          });
        }
        await tx.anonymousConversation.update({
          where: { id: conv.id },
          data: { migratedConversationId: created.id },
        });
      });
      migratedUserMessageCount += conv.messages.filter(
        (m) => m.role === 'USER',
      ).length;
    }

    await this.prisma.anonymousSession.update({
      where: { id: session.id },
      data: { migratedToUserId: userId, migratedAt: new Date() },
    });

    // بدون این، چرخه‌ی anonymous→signup می‌توانست trial رایگان کاربر تازه را دور بزند
    // (docs/PRD-growth-traction-features.md بخش ۳ — lifetimeMessageCount مبنای پایان trial است)
    if (migratedUserMessageCount > 0) {
      await this.prisma.user
        .update({
          where: { id: userId },
          data: {
            lifetimeMessageCount: { increment: migratedUserMessageCount },
          },
        })
        .catch((err) =>
          this.logger.error(
            `lifetimeMessageCount increment failed for user=${userId}`,
            err,
          ),
        );
    }

    await this.funnelEvents.emit(session.id, 'SIGNUP_COMPLETED');
  }
}
