import { Injectable } from '@nestjs/common';
import type { ContentChangeSource, ContentEntityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface FieldChangeEntry {
  storeId: string;
  sellerId: string;
  entityType: ContentEntityType;
  entityId: string | null;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  source?: ContentChangeSource;
}

// docs/PRD-seller-guide-assistant-modal.md بخش ۱.۳ — لاگ تغییرات محتوا: فروشنده کی چه فیلدی
// (دسته‌بندی/برند/ارسال/مرجوعی/یادداشت/محصول/باکس‌دانش/قانون ارسال) را به چه چیزی تغییر داده،
// دستی یا از پیشنهاد AI اعمال‌شده. فقط فیلدهای متنی/توصیفی را تراکینگ می‌کند.
@Injectable()
export class ContentChangeLogService {
  constructor(private readonly prisma: PrismaService) {}

  async logFieldChange(entry: FieldChangeEntry): Promise<void> {
    if (entry.oldValue === entry.newValue) return; // چیزی واقعاً عوض نشده
    await this.prisma.contentChangeLog.create({
      data: {
        storeId: entry.storeId,
        sellerId: entry.sellerId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        fieldName: entry.fieldName,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        source: entry.source ?? 'MANUAL',
      },
    });
  }

  async logMany(entries: FieldChangeEntry[]): Promise<void> {
    for (const entry of entries) await this.logFieldChange(entry);
  }
}
