import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramApiClientService } from '../telegram/telegram-api-client.service';
import { fa } from '../../i18n/fa';

// docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۹ (غنی‌سازی دوره‌ای) — محصولی که
// بیش از این مدت آپدیت نشده «قدیمی» حساب می‌شود (قیمت بازار/رقبا ممکن است عوض شده باشد)
const STALE_PRODUCT_DAYS = 60;
// بین دو یادآوری تلگرامی برای یک فروشگاه حداقل این‌قدر فاصله باشد — جلوگیری از اسپم هفتگی
// روی فروشگاهی که همچنان همان محصولات قدیمی را دارد
const NOTIFY_COOLDOWN_DAYS = 25;
const SAMPLE_NAMES_COUNT = 5;

@Injectable()
export class ProductEnrichmentReminderService {
  private readonly logger = new Logger(ProductEnrichmentReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramApi: TelegramApiClientService,
  ) {}

  // queue.module.ts (ProductEnrichmentReminderProcessor) این را هفتگی صدا می‌زند — فقط
  // فروشگاه‌هایی که تلگرام فروشنده‌شان وصل است می‌توانند نوتیف بگیرند، چون کانال دیگری
  // برای پوش به فروشنده وجود ندارد (بدون زیرساخت نوتیف جدید، طبق PRD)
  async sendDueReminders(): Promise<void> {
    const staleThreshold = new Date(
      Date.now() - STALE_PRODUCT_DAYS * 24 * 60 * 60 * 1000,
    );
    const cooldownThreshold = new Date(
      Date.now() - NOTIFY_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
    );

    const eligibleStores = await this.prisma.store.findMany({
      where: {
        ownerTelegramChatId: { not: null },
        OR: [
          { lastEnrichmentNudgeAt: null },
          { lastEnrichmentNudgeAt: { lt: cooldownThreshold } },
        ],
      },
      select: { id: true, ownerTelegramChatId: true },
    });

    for (const store of eligibleStores) {
      try {
        const staleProducts = await this.prisma.product.findMany({
          where: { storeId: store.id, updatedAt: { lt: staleThreshold } },
          select: { name: true },
          orderBy: { updatedAt: 'asc' },
          take: SAMPLE_NAMES_COUNT,
        });
        if (staleProducts.length === 0) continue;

        const staleCount = await this.prisma.product.count({
          where: { storeId: store.id, updatedAt: { lt: staleThreshold } },
        });
        const sampleNames = staleProducts.map((p) => p.name).join('، ');

        await this.telegramApi.sendText(
          store.ownerTelegramChatId as string,
          fa.telegram.enrichmentReminder(staleCount, sampleNames),
        );
        await this.prisma.store.update({
          where: { id: store.id },
          data: { lastEnrichmentNudgeAt: new Date() },
        });
      } catch (err) {
        this.logger.error(
          `enrichment reminder failed for store=${store.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }
  }
}
