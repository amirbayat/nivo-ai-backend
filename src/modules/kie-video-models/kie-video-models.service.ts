import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { KieVideoModel } from '@prisma/client';
import { fa } from '../../i18n/fa';

export type CreateKieVideoModelData = Omit<
  KieVideoModel,
  'id' | 'createdAt' | 'updatedAt'
>;
export type UpdateKieVideoModelData = Partial<CreateKieVideoModelData>;

// کاتالوگ مدل‌های ویدیوی Kie.ai — docs/PRD-video-edit-omni-kie.md بخش «مدل داده». عمداً یک
// جدول جدا از AiModel است (نه فقط یک platform جدید روی همان جدول)، چون شکل ورودی این مدل‌ها
// (image_urls/video_list با پنجره‌ی start/end) با فیلدهای عکس/چت‌محور AiModel هم‌خانواده نیست.
@Injectable()
export class KieVideoModelsService {
  constructor(private readonly prisma: PrismaService) {}

  // فرانت/preflight فقط مدل‌های فعال را می‌بینند، مرتب‌شده طبق ترتیب دلخواه ادمین
  async listActive(): Promise<KieVideoModel[]> {
    return this.prisma.kieVideoModel.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // پنل ادمین همه را می‌بیند، حتی غیرفعال‌ها (برای toggle کردن دوباره)
  async listAll(): Promise<KieVideoModel[]> {
    return this.prisma.kieVideoModel.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getById(id: string): Promise<KieVideoModel> {
    const model = await this.prisma.kieVideoModel.findUnique({ where: { id } });
    if (!model) throw new NotFoundException(fa.videoEdit.modelNotFound);
    return model;
  }

  async create(data: CreateKieVideoModelData): Promise<KieVideoModel> {
    return this.prisma.kieVideoModel.create({ data });
  }

  async update(
    id: string,
    data: UpdateKieVideoModelData,
  ): Promise<KieVideoModel> {
    await this.getById(id);
    return this.prisma.kieVideoModel.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.getById(id);
    // soft: فقط غیرفعال می‌کنیم، نه حذف واقعی — جاب‌های قدیمی به این مدل foreign key دارند
    // (VideoEditJob.kieVideoModelId، onDelete: RESTRICT عمداً، برای حفظ تاریخچه)
    await this.prisma.kieVideoModel.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
