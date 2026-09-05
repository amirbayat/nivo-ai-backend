import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { CaptionProjectStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

// safety-net خودکار — طبق تصمیم محصولی: سورس تا وقتی کاربر صریحاً درخواست حذف نداده نگه
// داشته می‌شود (برای امکان «رندر دوباره»)، ولی اگر پروژه مدت طولانی بی‌فعالیت بماند
// (کاربر هیچ‌وقت خودش حذفش نکرد) باید همین‌جا خودکار پاک شود — وگرنه دقیقاً همان مشکل
// «فضای MinIO بی‌رویه پر می‌شود» که این فیچر برایش ساخته شده باقی می‌ماند.
// الگوی دقیق chat-image-cleanup.processor.ts، فقط روی caption_projects.
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 200;

@Processor('caption-source-cleanup')
export class CaptionSourceCleanupProcessor {
  private readonly logger = new Logger(CaptionSourceCleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Process('cleanup')
  async handleCleanup() {
    const cutoff = new Date(Date.now() - RETENTION_MS);

    const projects = await this.prisma.captionProject.findMany({
      where: {
        status: { in: [CaptionProjectStatus.DONE, CaptionProjectStatus.FAILED] },
        sourceDeletedAt: null,
        updatedAt: { lt: cutoff },
      },
      select: { id: true, sourceVideoKey: true, debugAudioKey: true },
      take: BATCH_SIZE,
    });

    if (!projects.length) return;

    let cleaned = 0;
    for (const project of projects) {
      await Promise.all([
        this.storage.deleteObject(project.sourceVideoKey).catch((err) => {
          this.logger.warn(
            `MinIO delete failed for sourceVideoKey=${project.sourceVideoKey}: ${(err as Error).message}`,
          );
        }),
        project.debugAudioKey
          ? this.storage.deleteObject(project.debugAudioKey).catch((err) => {
              this.logger.warn(
                `MinIO delete failed for debugAudioKey=${project.debugAudioKey}: ${(err as Error).message}`,
              );
            })
          : Promise.resolve(),
      ]);
      await this.prisma.captionProject.update({
        where: { id: project.id },
        data: { sourceDeletedAt: new Date() },
      });
      cleaned++;
    }

    this.logger.log(
      `Caption source cleanup: freed source video/audio on ${cleaned} project(s) older than 7d`,
    );
  }
}
