import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { cert, initializeApp, type App } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'
import { PrismaService } from '../../prisma/prisma.service'

/**
 * پوش FCM به اپ موبایل ادمین (docs/PRD-admin-notifications-and-mobile.md بخش ۵/۶) — best-effort:
 * اگر FIREBASE_SERVICE_ACCOUNT ست نشده باشد (dev/local)، silently no-op می‌شود تا dev بدون
 * پروژه‌ی Firebase هم کار کند؛ لیست/polling صفحه‌ی نوتیف مستقل از این کار می‌کند.
 */
@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name)
  private app: App | null = null

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    const raw = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT')
    if (!raw) {
      this.logger.warn('FIREBASE_SERVICE_ACCOUNT تنظیم نشده — پوش FCM ادمین غیرفعال است')
      return
    }
    try {
      const serviceAccount = JSON.parse(raw)
      this.app = initializeApp({ credential: cert(serviceAccount) }, 'admin-notifications')
    } catch (err) {
      this.logger.error('مقدار FIREBASE_SERVICE_ACCOUNT نامعتبر است — پوش FCM ادمین غیرفعال ماند', err)
    }
  }

  async sendToAllAdmins(title: string, body: string): Promise<void> {
    if (!this.app) return

    const devices = await this.prisma.adminDeviceToken.findMany({ select: { token: true } })
    if (!devices.length) return

    const response = await getMessaging(this.app).sendEachForMulticast({
      tokens: devices.map((d) => d.token),
      notification: { title, body },
    })

    // توکن‌های نامعتبر/منقضی (اپ حذف شده و مشابه) را همین‌جا پاک می‌کنیم تا لیست تمیز بماند —
    // بدون این، هر ارسال بعدی همچنان تلاش بی‌فایده روی همین توکن‌های مرده انجام می‌دهد
    const invalidTokens = response.responses
      .map((r, i) => (r.success ? null : devices[i].token))
      .filter((t): t is string => t !== null)

    if (invalidTokens.length) {
      await this.prisma.adminDeviceToken.deleteMany({ where: { token: { in: invalidTokens } } })
    }
  }
}
