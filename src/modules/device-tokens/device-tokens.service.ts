import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

// docs/PRD-user-push-notifications-and-mobile-app-flows.md بخش ۳/۵.۲ — توکن FCM کاربر عادی
// اپ اندروید؛ قبل از لاگین با deviceUuid ناشناس ثبت می‌شود، بعد از OTP به userId وصل می‌شود
@Injectable()
export class DeviceTokensService {
  private readonly logger = new Logger(DeviceTokensService.name)

  constructor(private readonly prisma: PrismaService) {}

  register(deviceUuid: string, fcmToken: string) {
    return this.prisma.deviceToken.upsert({
      where: { deviceUuid },
      create: { deviceUuid, fcmToken },
      update: { fcmToken },
    })
  }

  // از auth.service.ts: verifyOtp صدا زده می‌شود — نباید لاگین را fail کند، پس caller خودش try/catch می‌کند
  async attachToUser(deviceUuid: string, userId: string): Promise<void> {
    await this.prisma.deviceToken.updateMany({
      where: { deviceUuid, userId: null },
      data: { userId },
    })
  }
}
