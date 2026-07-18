import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { cert, initializeApp, type App } from 'firebase-admin/app'

// نقطه‌ی واحد initialize کردن firebase-admin — هم admin-notifications (پوش به ادمین) هم
// push-notifications (پوش به کاربران) از همین یک App استفاده می‌کنند، به‌جای این‌که هرکدام
// initializeApp جدا با اسم متفاوت صدا بزنند. اگر FIREBASE_SERVICE_ACCOUNT ست نشده باشد
// (dev/local)، silently no-op می‌ماند — همان رفتار قبلی fcm.service.ts.
@Injectable()
export class FirebaseAdminAppProvider implements OnModuleInit {
  private readonly logger = new Logger(FirebaseAdminAppProvider.name)
  private app: App | null = null

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const raw = this.config.get<string>('FIREBASE_SERVICE_ACCOUNT')
    if (!raw) {
      this.logger.warn('FIREBASE_SERVICE_ACCOUNT تنظیم نشده — پوش FCM غیرفعال است')
      return
    }
    try {
      const serviceAccount = JSON.parse(raw)
      this.app = initializeApp({ credential: cert(serviceAccount) }, 'nivo-fcm')
    } catch (err) {
      this.logger.error('مقدار FIREBASE_SERVICE_ACCOUNT نامعتبر است — پوش FCM غیرفعال ماند', err)
    }
  }

  getApp(): App | null {
    return this.app
  }
}
