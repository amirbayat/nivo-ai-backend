import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

const RETENTION_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 200;

@Processor('chat-image-cleanup')
export class ChatImageCleanupProcessor {
  private readonly logger = new Logger(ChatImageCleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Process('cleanup')
  async handleCleanup() {
    const cutoff = new Date(Date.now() - RETENTION_MS);

    const messages = await this.prisma.message.findMany({
      where: { images: { not: Prisma.DbNull }, createdAt: { lt: cutoff } },
      select: { id: true, images: true },
      take: BATCH_SIZE,
    });

    if (!messages.length) return;

    let cleaned = 0;
    for (const message of messages) {
      const images = (message.images as string[] | null) ?? [];
      await Promise.all(
        images
          .filter((img) => this.storage.isStorageKey(img))
          .map((key) =>
            this.storage.deleteObject(key).catch((err) => {
              this.logger.warn(
                `MinIO delete failed for ${key}: ${(err as Error).message}`,
              );
            }),
          ),
      );
      await this.prisma.message.update({
        where: { id: message.id },
        data: { images: Prisma.DbNull },
      });
      cleaned++;
    }

    this.logger.log(
      `Chat image cleanup: cleared images on ${cleaned} message(s) older than 24h`,
    );
  }
}
