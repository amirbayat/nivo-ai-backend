import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { fa } from '../../i18n/fa';

// contextMd/userPromptTemplate سبک پین‌شده عمداً select نمی‌شود — همان قانون پنهان‌ماندن
// prompt پشت‌صحنه که در DiscoveryGenerationService.listCatalog هم رعایت شده
const PINNED_PROMPT_SELECT = {
  id: true,
  title: true,
  exampleImageUrl: true,
  creditCost: true,
  outputType: true,
} as const;

// بدون محدودیت تعداد در فاز ۱ (سؤال ۸، بخش ۱۱ سند فنی) — پروژه فقط چند ردیف متن است،
// هزینه‌ای برای سیستم ندارد؛ فقط تولیدهایی که با آن انجام می‌شوند نیوو مصرف می‌کنند.
@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.project.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
      include: { pinnedPrompt: { select: PINNED_PROMPT_SELECT } },
    });
  }

  async get(userId: string, id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { pinnedPrompt: { select: PINNED_PROMPT_SELECT } },
    });
    if (!project) throw new NotFoundException(fa.discovery.projectNotFound);
    if (project.userId !== userId)
      throw new ForbiddenException(fa.errors.forbidden);
    return project;
  }

  // فقط سبک‌های تاییدشده/فعال قابل‌پین‌شدن‌اند — هیچ‌وقت یک پیشنهاد PENDING/REJECTED
  private async assertPinnablePrompt(pinnedPromptId: string) {
    const prompt = await this.prisma.creativePrompt.findFirst({
      where: { id: pinnedPromptId, isActive: true },
      select: { id: true },
    });
    if (!prompt) throw new BadRequestException(fa.discovery.pinnedPromptMustBeActive);
  }

  async create(userId: string, dto: CreateProjectDto) {
    if (dto.pinnedPromptId) await this.assertPinnablePrompt(dto.pinnedPromptId);
    return this.prisma.project.create({ data: { ...dto, userId } });
  }

  async update(userId: string, id: string, dto: UpdateProjectDto) {
    await this.get(userId, id); // مالکیت را چک می‌کند (۴۰۴/۴۰۳ مناسب پرتاب می‌کند)
    if (dto.pinnedPromptId) await this.assertPinnablePrompt(dto.pinnedPromptId);
    return this.prisma.project.update({ where: { id }, data: dto });
  }

  // حذف نرم — پروژه از لیست/انتخاب‌گر مخفی می‌شود ولی تاریخچه‌ی CreativeGeneration
  // (بخش ۵.۹/گالری) که به آن اشاره دارند دست‌نخورده می‌ماند (projectId فقط SetNull با حذف واقعی)
  async softDelete(userId: string, id: string) {
    await this.get(userId, id);
    await this.prisma.project.update({
      where: { id },
      data: { isActive: false },
    });
    return { message: 'پروژه حذف شد' };
  }
}
