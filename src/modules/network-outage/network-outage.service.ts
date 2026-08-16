import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { fa } from '../../i18n/fa';
import type { NetworkOutage } from '@prisma/client';

/**
 * «قطع نت» (منوی ادمین) — وقتی اینترنت/سرویس قطع می‌شود، ادمین قطعی را «شروع» می‌زند؛ وقتی
 * وصل شد «پایان» می‌زند. در لحظه‌ی پایان، دقیقاً به‌اندازه‌ی مدت قطعی به periodEnd اشتراک‌های
 * فعالِ غیررایگان (اکو/پلاس) اضافه می‌شود — یعنی کاربری که ۱۳ روز اشتراکش مانده بود، بعد از
 * ۱۰ روز قطعی هنوز ۱۳ روز دارد، نه ۳ روز.
 */
@Injectable()
export class NetworkOutageService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrent(): Promise<NetworkOutage | null> {
    return this.prisma.networkOutage.findFirst({ where: { endedAt: null } });
  }

  async history(limit: number): Promise<NetworkOutage[]> {
    return this.prisma.networkOutage.findMany({
      where: { endedAt: { not: null } },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  async start(adminId: string): Promise<NetworkOutage> {
    const open = await this.getCurrent();
    if (open) throw new BadRequestException(fa.networkOutage.alreadyOpen);

    return this.prisma.networkOutage.create({
      data: { createdByAdminId: adminId },
    });
  }

  async end(): Promise<NetworkOutage> {
    const outage = await this.getCurrent();
    if (!outage) throw new NotFoundException(fa.networkOutage.noneOpen);

    const endedAt = new Date();
    const durationMs = endedAt.getTime() - outage.startedAt.getTime();

    // فقط اشتراک‌های فعالِ غیررایگان (priceMonthly > 0) جابه‌جا می‌شوند — همان معیار تشخیص
    // پلن رایگان/غیررایگان که در token.service.ts هم استفاده می‌شود (بدون ستون tier جدا)
    const affected = await this.prisma.$executeRaw`
      UPDATE subscriptions s
      SET "periodEnd" = s."periodEnd" + (${durationMs}::double precision * interval '1 millisecond'),
          "updatedAt" = now()
      FROM plans p
      WHERE s."planId" = p.id AND p."priceMonthly" > 0 AND s.status = 'ACTIVE'
    `;

    return this.prisma.networkOutage.update({
      where: { id: outage.id },
      data: {
        endedAt,
        extendedDays: durationMs / 86_400_000,
        affectedCount: Number(affected),
      },
    });
  }
}
