import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SalesAgentVoiceWebhookService } from './sales-agent-voice-webhook.service';
import { SALES_AGENT_VOICE_WEBHOOK_ROUTE } from './sales-agent-voice-webhook.constants';

// همون الگوی VideoEditWebhookController — کنترلر جدا، بدون JwtGuard (Kie از بیرون صدا می‌زند)،
// امنیت با امضای HMAC تأمین می‌شود (kie-webhook-signature.util.ts، همون util مشترک)
@Controller('sales-agent-voice')
export class SalesAgentVoiceWebhookController {
  constructor(private readonly webhook: SalesAgentVoiceWebhookService) {}

  @SkipThrottle()
  @Post(SALES_AGENT_VOICE_WEBHOOK_ROUTE)
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
