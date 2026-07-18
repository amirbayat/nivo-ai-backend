import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { AdminNotificationType, Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { fa } from '../../i18n/fa'
import { FcmService } from './fcm.service'

const PAGE_SIZE = 30

@Injectable()
export class AdminNotificationsService {
  private readonly logger = new Logger(AdminNotificationsService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly fcm: FcmService,
  ) {}

  /**
   * محل واحد ساخت نوتیف ادمین — از سه جا صدا زده می‌شود: هوک تیکت/پرداخت (docs/PRD-admin-notifications-and-mobile.md
   * بخش ۴) و processor چک آستانه‌ی سیستمی. همیشه فایر-اند-فورگت از سمت caller صدا زده شود (پرداخت/تیکت
   * نباید هرگز به‌خاطر شکست نوتیف fail شود).
   */
  async notify(
    type: AdminNotificationType,
    title: string,
    body: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    const notification = await this.prisma.adminNotification.create({
      data: { type, title, body, metadata },
    })

    this.fcm
      .sendToAllAdmins(title, body)
      .catch((err) => this.logger.error(`fcm push failed for notification ${notification.id}`, err))

    return notification
  }

  async list(page = 1) {
    const [items, total] = await Promise.all([
      this.prisma.adminNotification.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.adminNotification.count(),
    ])
    return { items, total, page, pageSize: PAGE_SIZE }
  }

  unreadCount(adminId: string) {
    return this.prisma.adminNotification.count({
      where: { NOT: { readBy: { has: adminId } } },
    })
  }

  async markRead(id: string, adminId: string) {
    const notification = await this.prisma.adminNotification.findUnique({ where: { id } })
    if (!notification) throw new NotFoundException(fa.adminNotification.notFound)
    if (notification.readBy.includes(adminId)) return notification

    return this.prisma.adminNotification.update({
      where: { id },
      data: { readBy: { push: adminId } },
    })
  }

  async markAllRead(adminId: string) {
    const { count } = await this.prisma.adminNotification.updateMany({
      where: { NOT: { readBy: { has: adminId } } },
      data: { readBy: { push: adminId } },
    })
    return { updatedCount: count }
  }

  async registerDeviceToken(adminId: string, token: string) {
    return this.prisma.adminDeviceToken.upsert({
      where: { token },
      create: { adminId, token },
      update: { adminId },
    })
  }
}
