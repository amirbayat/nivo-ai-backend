import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditEntry {
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  reason: string;
}

// R1.1 — ثبت کارهای حساس ادمین. داخل تراکنش اصلی (tx) تا «تغییر + لاگ» یا هر دو یا هیچ.
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  record(entry: AuditEntry, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return client.adminAuditLog.create({
      data: {
        adminId: entry.adminId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        before: entry.before === undefined ? undefined : (entry.before as Prisma.InputJsonValue),
        after: entry.after === undefined ? undefined : (entry.after as Prisma.InputJsonValue),
        reason: entry.reason,
      },
    });
  }

  // برای مسیرهایی که نباید به‌خاطر شکست لاگ خراب شوند (impersonation)؛ شکست فقط لاگ می‌شود
  async recordSafely(entry: AuditEntry): Promise<void> {
    try {
      await this.record(entry);
    } catch (err) {
      this.logger.error(`audit log failed (${entry.action} ${entry.targetId})`, err as Error);
    }
  }

  listForTarget(targetType: string, targetId: string, take = 50) {
    return this.prisma.adminAuditLog.findMany({
      where: { targetType, targetId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
