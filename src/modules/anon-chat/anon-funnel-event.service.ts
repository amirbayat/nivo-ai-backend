import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type AnonFunnelEventType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// یک ردیف به‌ازای هر (session, eventType) — idempotent، تا فانل بر اساس شمارش distinct
// session به هر مرحله محاسبه شود، نه event count خام (کلیک تکراری/رفرش صفحه دوباره‌شمار نشود)
@Injectable()
export class AnonFunnelEventService {
  private readonly logger = new Logger(AnonFunnelEventService.name);

  constructor(private readonly prisma: PrismaService) {}

  async emit(
    sessionId: string,
    eventType: AnonFunnelEventType,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.anonymousFunnelEvent.create({
        data: {
          sessionId,
          eventType,
          ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
        },
      });
    } catch (err) {
      // P2002 = unique constraint (sessionId, eventType) — این مرحله قبلاً برای این session ثبت شده
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )
        return;
      this.logger.warn(
        `funnel event emit failed (session=${sessionId}, type=${eventType}): ${(err as Error).message}`,
      );
    }
  }
}
