import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { VideoEditWebhookService } from './video-edit-webhook.service';
import { KIE_WEBHOOK_ROUTE } from './kie-webhook.constants';

// کنترلر جدا از VideoEditController (که @UseGuards(JwtGuard) روی کل کلاس دارد) — این مسیر باید
// عمومی/بدون JWT باشد چون Kie از بیرون صدا می‌زند، نه کاربر لاگین‌کرده؛ امنیت با امضای
// HMAC (X-Webhook-Timestamp/X-Webhook-Signature، رجوع کن به kie-webhook-signature.util.ts)
// تأمین می‌شود، نه JwtGuard.
@Controller('video-edit')
export class VideoEditWebhookController {
  constructor(private readonly webhook: VideoEditWebhookService) {}

  @SkipThrottle()
  @Post(KIE_WEBHOOK_ROUTE)
  @HttpCode(200)
  async kieCallback(
    @Body() body: unknown,
    @Headers('x-webhook-timestamp') timestamp?: string,
    @Headers('x-webhook-signature') signature?: string,
  ): Promise<{ received: true }> {
    await this.webhook.handleKieCallback(body, timestamp, signature);
    return { received: true };
  }
}
