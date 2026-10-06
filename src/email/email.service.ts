import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { en } from '../i18n/en';

// docs/PRD-instagram-smart-dm-and-ir-intl-split.md بخش ۳/۷.۱ — آینه‌ی sms.service.ts برای
// REGION=INTL. عمداً SMTP عمومی (نه یک provider خاص مثل Resend/SendGrid) چون provider نهایی
// هنوز انتخاب نشده — هر SMTP relay (SES/Mailgun/Postmark/...) بدون تغییر کد کار می‌کند.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly devMode: boolean;
  private readonly from: string;
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    this.devMode = this.config.get<string>('SEND_EMAIL', 'false') !== 'true';
    this.from = this.config.get<string>(
      'SMTP_FROM',
      'Nivo AI <no-reply@nivoai.site>',
    );

    if (!this.devMode) {
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>('SMTP_HOST'),
        port: this.config.get<number>('SMTP_PORT', 587),
        secure: this.config.get<number>('SMTP_PORT', 587) === 465,
        auth: {
          user: this.config.get<string>('SMTP_USER'),
          pass: this.config.get<string>('SMTP_PASS'),
        },
      });
    }
  }

  async sendVerificationCode(to: string, code: string): Promise<void> {
    if (this.devMode) {
      this.logger.warn(
        `🔑 EMAIL OTP ══════════════════ ${to}  →  ${code} ══════════════════`,
      );
      return;
    }

    try {
      await this.transporter!.sendMail({
        from: this.from,
        to,
        subject: en.auth.emailOtpSubject,
        text: en.auth.emailOtpBody(code),
      });
      this.logger.log(`verification email sent to ${to}`);
    } catch (err) {
      this.logger.error(`email send failed for ${to}`, err as Error);
      throw new InternalServerErrorException(en.auth.emailSendFailed);
    }
  }
}
