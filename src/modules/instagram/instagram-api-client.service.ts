import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// docs/PRD-instagram-smart-dm-and-ir-intl-split.md بخش ۴.۱/۴.۳ — آینه‌ی telegram-api-client
// ولی توکن per-store است (نه یک بات مشترک)؛ هر تماس accessToken خودِ فروشگاه را می‌گیرد.
// قبل از اولین تست واقعی حتماً باید نسخه‌ی Graph API (v-عدد) با چیزی که در Meta Developer
// واقعاً فعال است چک شود — همین الان فقط یک پیش‌فرض منطقی است.
@Injectable()
export class InstagramApiClientService {
  private readonly logger = new Logger(InstagramApiClientService.name);
  private readonly apiBaseUrl: string;
  private readonly appId?: string;
  private readonly appSecret?: string;

  constructor(private readonly config: ConfigService) {
    this.apiBaseUrl =
      this.config.get<string>('INSTAGRAM_GRAPH_API_BASE_URL') ??
      'https://graph.instagram.com/v24.0';
    this.appId = this.config.get<string>('INSTAGRAM_APP_ID');
    this.appSecret = this.config.get<string>('INSTAGRAM_APP_SECRET');
  }

  private async call(
    path: string,
    accessToken: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.apiBaseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, access_token: accessToken }),
      });
    } catch (err) {
      this.logger.error(
        `instagram call ${path} network error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      this.logger.error(
        `instagram call ${path} failed: ${res.status} ${JSON.stringify(json)}`,
      );
    }
    return json;
  }

  // پاسخ عمومی زیر کامنت
  replyToComment(accessToken: string, commentId: string, text: string) {
    return this.call(`/${commentId}/replies`, accessToken, { message: text });
  }

  // دایرکت خصوصی به کسی که کامنت گذاشته — فقط تا ۷ روز بعد از کامنت معتبر است (قید پلتفرم)
  sendPrivateReplyToComment(
    accessToken: string,
    igBusinessId: string,
    commentId: string,
    text: string,
  ) {
    return this.call(`/${igBusinessId}/messages`, accessToken, {
      recipient: { comment_id: commentId },
      message: { text },
    });
  }

  // دایرکت معمولی (پاسخ به استوری/منشن/دایرکت) — پنجره‌ی ۲۴ساعته‌ی استاندارد پلتفرم اعمال می‌شود
  sendDirectMessage(
    accessToken: string,
    igBusinessId: string,
    recipientPsid: string,
    text: string,
  ) {
    return this.call(`/${igBusinessId}/messages`, accessToken, {
      recipient: { id: recipientPsid },
      message: { text },
    });
  }

  // تبدیل authorization code (از OAuth redirect) به توکن کوتاه‌مدت، سپس به long-lived
  async exchangeCodeForLongLivedToken(
    code: string,
    redirectUri: string,
  ): Promise<{
    accessToken: string;
    igBusinessId: string;
    expiresInSeconds: number;
  } | null> {
    if (!this.appId || !this.appSecret) {
      this.logger.warn(
        'exchangeCodeForLongLivedToken skipped: INSTAGRAM_APP_ID/SECRET not set',
      );
      return null;
    }
    try {
      const shortRes = await fetch(
        'https://api.instagram.com/oauth/access_token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: this.appId,
            client_secret: this.appSecret,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
            code,
          }),
        },
      );
      const short = (await shortRes.json()) as {
        access_token?: string;
        user_id?: string;
      };
      if (!short.access_token || !short.user_id) {
        this.logger.error(
          `short-lived token exchange failed: ${JSON.stringify(short)}`,
        );
        return null;
      }

      const longRes = await fetch(
        `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${this.appSecret}&access_token=${short.access_token}`,
      );
      const long = (await longRes.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      if (!long.access_token) {
        this.logger.error(
          `long-lived token exchange failed: ${JSON.stringify(long)}`,
        );
        return null;
      }

      return {
        accessToken: long.access_token,
        igBusinessId: short.user_id,
        expiresInSeconds: long.expires_in ?? 60 * 24 * 60 * 60,
      };
    } catch (err) {
      this.logger.error(
        `exchangeCodeForLongLivedToken error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
