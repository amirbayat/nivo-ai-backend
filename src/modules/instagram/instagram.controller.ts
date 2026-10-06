import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { InstagramService } from './instagram.service';
import type { InstagramWebhookPayload } from './instagram.types';

// docs/PRD-instagram-smart-dm-and-ir-intl-split.md بخش ۷.۲ — سمت Meta صدا می‌زند، بدون
// JwtGuard (دقیقاً مثل telegram.controller.ts)؛ امنیت از challenge token (GET) و
// X-Hub-Signature-256 (POST) تأمین می‌شود، نه auth کاربر
@Controller('v2/instagram')
export class InstagramController {
  private readonly logger = new Logger(InstagramController.name);

  constructor(private readonly instagram: InstagramService) {}

  @SkipThrottle()
  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    const result = this.instagram.verifyChallenge(mode, token, challenge);
    if (result === null) {
      this.logger.warn('webhook verify rejected: token mismatch');
      throw new ForbiddenException();
    }
    return result;
  }

  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() payload: InstagramWebhookPayload,
    @Headers('x-hub-signature-256') signature?: string,
  ): Promise<{ ok: true }> {
    // main.ts (useBodyParser 'json' → verify hook) همین بافر خام را روی req.rawBody می‌گذارد؛
    // امضا باید دقیقاً روی این بایت‌ها چک شود، نه JSON.stringify دوباره (که می‌تواند فرمتش
    // با چیزی که Meta امضا کرده فرق کند)
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(payload));
    if (!this.instagram.verifySignature(rawBody, signature)) {
      this.logger.warn('webhook rejected: signature mismatch');
      throw new ForbiddenException();
    }
    await this.instagram.handlePayload(payload);
    return { ok: true };
  }

  // بخش ۵ (Meta App Review) — Data Deletion Request Callback. فرمت پاسخ طبق مستندات متا:
  // { url, confirmation_code } — متا بعداً با همون کد وضعیت را از همین url پیگیری می‌کند
  @Post('data-deletion')
  @HttpCode(200)
  async dataDeletion(
    @Body() body: { signed_request?: string; user_id?: string },
  ): Promise<{ url: string; confirmation_code: string }> {
    const instagramBusinessId = body.user_id ?? '';
    if (instagramBusinessId) {
      await this.instagram.deleteStoreInstagramData(instagramBusinessId);
    }
    const confirmationCode = `del_${Date.now()}`;
    return {
      url: `https://nivoai.site/data-deletion-status?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    };
  }
}
