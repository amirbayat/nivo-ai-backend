import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateProjectDto } from './dto/create-project.dto'
import { UpdateProjectDto } from './dto/update-project.dto'
import { fa } from '../../i18n/fa'

// بدون محدودیت تعداد در فاز ۱ (سؤال ۸، بخش ۱۱ سند فنی) — پروژه فقط چند ردیف متن است،
// هزینه‌ای برای سیستم ندارد؛ فقط تولیدهایی که با آن انجام می‌شوند نیوو مصرف می‌کنند.
@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.project.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  async get(userId: string, id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } })
    if (!project) throw new NotFoundException(fa.discovery.projectNotFound)
    if (project.userId !== userId) throw new ForbiddenException(fa.errors.forbidden)
    return project
  }

  create(userId: string, dto: CreateProjectDto) {
    return this.prisma.project.create({ data: { ...dto, userId } })
  }

  async update(userId: string, id: string, dto: UpdateProjectDto) {
    await this.get(userId, id) // مالکیت را چک می‌کند (۴۰۴/۴۰۳ مناسب پرتاب می‌کند)
    return this.prisma.project.update({ where: { id }, data: dto })
  }

  // حذف نرم — پروژه از لیست/انتخاب‌گر مخفی می‌شود ولی تاریخچه‌ی CreativeGeneration
  // (بخش ۵.۹/گالری) که به آن اشاره دارند دست‌نخورده می‌ماند (projectId فقط SetNull با حذف واقعی)
  async softDelete(userId: string, id: string) {
    await this.get(userId, id)
    await this.prisma.project.update({ where: { id }, data: { isActive: false } })
    return { message: 'پروژه حذف شد' }
  }
}
