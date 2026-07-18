import { Injectable } from '@nestjs/common'
import { PushCampaignSegment, type SubscriptionStatus } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { normalizePhone } from '../../common/utils/normalize-phone'
import { PushFcmService } from './fcm.service'
import { SendPushNotificationDto } from './dto/send-push-notification.dto'

const PAGE_SIZE = 30

// docs/PRD-user-push-notifications-and-mobile-app-flows.md بخش ۳/۶ — ارسال پوش دلخواه ادمین
// به دسته‌ای از کاربران (بر خلاف admin-notifications که پوش سیستمی به ادمین است)
@Injectable()
export class PushNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fcm: PushFcmService,
  ) {}

  async send(adminId: string, dto: SendPushNotificationDto) {
    const normalizedPhoneList = dto.segment === PushCampaignSegment.PHONE_LIST
      ? (dto.phoneList ?? []).map(normalizePhone)
      : []

    const tokens = await this.resolveTokens(dto.segment, normalizedPhoneList)

    const { sentCount, failedCount, invalidTokens } = await this.fcm.sendToTokens(tokens, dto.title, dto.body)

    // توکن‌های نامعتبر/منقضی را پاک می‌کنیم — دقیقاً همان الگوی admin-notifications/fcm.service.ts
    if (invalidTokens.length) {
      await this.prisma.deviceToken.deleteMany({ where: { fcmToken: { in: invalidTokens } } })
    }

    return this.prisma.pushCampaign.create({
      data: {
        title: dto.title,
        body: dto.body,
        segment: dto.segment,
        phoneList: normalizedPhoneList,
        sentCount,
        failedCount,
        createdByAdminId: adminId,
      },
    })
  }

  private async resolveTokens(segment: PushCampaignSegment, phoneList: string[]): Promise<string[]> {
    if (segment === PushCampaignSegment.PHONE_LIST && !phoneList.length) return []

    const where = (() => {
      switch (segment) {
        case PushCampaignSegment.ALL:
          return {}
        case PushCampaignSegment.REGISTERED_ONLY:
          return { userId: { not: null } }
        case PushCampaignSegment.ANONYMOUS_ONLY:
          return { userId: null }
        case PushCampaignSegment.ACTIVE_SUBSCRIBERS:
          return { user: { subscription: { is: { status: { in: ['ACTIVE', 'TRIAL'] as SubscriptionStatus[] } } } } }
        case PushCampaignSegment.PHONE_LIST:
          return { user: { phone: { in: phoneList } } }
      }
    })()

    const rows = await this.prisma.deviceToken.findMany({ where, select: { fcmToken: true } })
    return rows.map((r) => r.fcmToken)
  }

  async list(page = 1) {
    const [items, total] = await Promise.all([
      this.prisma.pushCampaign.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.pushCampaign.count(),
    ])
    return { items, total, page, pageSize: PAGE_SIZE }
  }
}
