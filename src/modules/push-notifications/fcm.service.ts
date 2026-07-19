import { Injectable, Logger } from '@nestjs/common'
import { getMessaging } from 'firebase-admin/messaging'
import { FirebaseAdminAppProvider } from '../../common/firebase/firebase-admin-app.provider'

// حد سقف tokens هر درخواست sendEachForMulticast
const CHUNK_SIZE = 500

export interface PushSendResult {
  sentCount: number
  failedCount: number
  invalidTokens: string[]
}

// docs/PRD-user-push-notifications-and-mobile-app-flows.md بخش ۴ — ارسال پوش به کاربران عادی
// (نه ادمین)؛ همان الگوی admin-notifications/fcm.service.ts، فقط با چانک‌بندی چون تعداد
// کاربران می‌تواند از سقف ۵۰۰تایی sendEachForMulticast بیشتر باشد
@Injectable()
export class PushFcmService {
  private readonly logger = new Logger(PushFcmService.name)

  constructor(private readonly firebase: FirebaseAdminAppProvider) {}

  async sendToTokens(tokens: string[], title: string, body: string): Promise<PushSendResult> {
    const app = this.firebase.getApp()
    if (!app || !tokens.length) {
      this.logger.warn(
        `sendToTokens: no-op (app=${!!app ? 'initialized' : 'null — FIREBASE_SERVICE_ACCOUNT تنظیم نشده'}, tokens=${tokens.length})`,
      )
      return { sentCount: 0, failedCount: tokens.length, invalidTokens: [] }
    }

    let sentCount = 0
    let failedCount = 0
    const invalidTokens: string[] = []

    for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
      const chunk = tokens.slice(i, i + CHUNK_SIZE)
      const response = await getMessaging(app).sendEachForMulticast({
        tokens: chunk,
        notification: { title, body },
      })
      sentCount += response.successCount
      failedCount += response.failureCount

      response.responses.forEach((r, idx) => {
        const token = chunk[idx]
        if (!r.success) {
          this.logger.error(
            `FCM FAILED token=${token.slice(0, 16)}... code=${r.error?.code} message=${r.error?.message}`,
          )
          invalidTokens.push(token)
        }
      })
    }

    return { sentCount, failedCount, invalidTokens }
  }
}
