import { Process, Processor } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { LiaraKeyProvisioningService } from '../../modules/liara/liara-key-provisioning.service'

// docs/PRD-liara-usage-reconciliation.md — کاربرانی که ساخت کلید اختصاصی‌شان قبلاً fail شده
// (LiaraKeyProvisioningIssue) را دوره‌ای دوباره امتحان می‌کند. کاربرانی که خودشان دوباره چت
// بزنند به‌طور طبیعی (lazy، از chat.service) دوباره امتحان می‌شوند — این جاب فقط پشتیبان
// کاربرانی است که فعلاً چت نمی‌زنند، تا با رفع مشکل (مثلاً تمدید JWT در Hamravesh) بدون نیاز
// به فعالیت خودِ کاربر به‌روز شوند.
@Processor('liara-key-retry')
export class LiaraKeyRetryProcessor {
  private readonly logger = new Logger(LiaraKeyRetryProcessor.name)

  constructor(private readonly provisioning: LiaraKeyProvisioningService) {}

  @Process('retry')
  async handleRetry() {
    const userIds = await this.provisioning.listIssueUserIds()
    if (!userIds.length) return

    let recovered = 0
    for (const userId of userIds) {
      try {
        await this.provisioning.getApiKeyForUser(userId)
        recovered++
      } catch {
        // هنوز حل نشده — ردیف LiaraKeyProvisioningIssue همان‌جا (داخل getApiKeyForUser) به‌روز
        // شد، دور بعدی این جاب دوباره امتحان می‌کند
      }
    }

    if (recovered > 0) {
      this.logger.log(`Liara key retry: ${recovered}/${userIds.length} user(s) recovered`)
    }
  }
}
