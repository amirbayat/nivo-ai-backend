import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { fa } from '../i18n/fa'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Kavenegar = require('kavenegar')

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name)
  private readonly api: any
  private readonly template: string
  private readonly devMode: boolean

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('KAVENEGAR_API_KEY', '')
    this.template = this.config.get<string>('KAVENEGAR_TEMPLATE', 'registerverify')
    this.devMode = this.config.get<string>('SEND_SMS', 'false') !== 'true'

    if (!this.devMode) {
      this.api = Kavenegar.KavenegarApi({ apikey: apiKey })
    }
  }

  async sendOtp(receptor: string, code: string): Promise<void> {
    if (this.devMode) {
      this.logger.warn(
        `🔑 OTP ══════════════════ ${receptor}  →  ${code} ══════════════════`,
      )
      return
    }

    await new Promise<void>((resolve, reject) => {
      this.api.VerifyLookup(
        { receptor, token: code, template: this.template },
        (response: any, status: number) => {
          if (status === 200) {
            this.logger.log(`OTP sent to ${receptor}`)
            resolve()
          } else {
            this.logger.error(`Kavenegar error — status: ${status}`, response)
            reject(new InternalServerErrorException(fa.sms.sendFailed))
          }
        },
      )
    })
  }

  /**
   * ارسال با الگوی از پیش تأییدشده در پنل کاوه‌نگار (همان مکانیزم VerifyLookup
   * که برای OTP استفاده می‌شود) — نه متن آزاد. متن پیام از قبل در خودِ کاوه‌نگار
   * ثبت و تأیید شده؛ اینجا فقط نام الگو + مقادیر جایگزین (%token%, %token2%, ...)
   * داده می‌شود. برای کمپین سافت‌لانچ (docs/PRD-global-budget-gateway.md بخش ۱۸.۷)
   * چون متن آزاد در خطوط عادی/مشترک معمولاً فیلتر یا رد می‌شود.
   */
  async sendByTemplate(
    receptor: string,
    template: string,
    tokens: { token?: string; token2?: string; token3?: string } = {},
  ): Promise<void> {
    if (this.devMode) {
      this.logger.warn(
        `📩 SMS (template=${template}) ══ ${receptor} → ${JSON.stringify(tokens)}`,
      )
      return
    }

    await new Promise<void>((resolve, reject) => {
      this.api.VerifyLookup(
        { receptor, template, ...tokens },
        (response: any, status: number) => {
          if (status === 200) {
            this.logger.log(`SMS (${template}) sent to ${receptor}`)
            resolve()
          } else {
            this.logger.error(`Kavenegar error — status: ${status}`, response)
            reject(new InternalServerErrorException(fa.sms.sendFailed))
          }
        },
      )
    })
  }
}
