import { Injectable, Logger } from '@nestjs/common'
import { getMessaging } from 'firebase-admin/messaging'
import { PrismaService } from '../../prisma/prisma.service'
import { FirebaseAdminAppProvider } from '../../common/firebase/firebase-admin-app.provider'

/**
 * پوش FCM به اپ موبایل ادمین (docs/PRD-admin-notifications-and-mobile.md بخش ۵/۶) — best-effort:
 * اگر FirebaseAdminAppProvider اپ را init نکرده باشد (FIREBASE_SERVICE_ACCOUNT ست نشده)، silently
 * no-op می‌شود تا dev بدون پروژه‌ی Firebase هم کار کند؛ لیست/polling صفحه‌ی نوتیف مستقل از این کار می‌کند.
 */
@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name)

  constructor(
    private readonly firebase: FirebaseAdminAppProvider,
    private readonly prisma: PrismaService,
  ) {}

  async sendToAllAdmins(title: string, body: string): Promise<void> {
    const app = this.firebase.getApp()
    if (!app) return

    const devices = await this.prisma.adminDeviceToken.findMany({ select: { token: true } })
    if (!devices.length) return

    const response = await getMessaging(app).sendEachForMulticast({
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
