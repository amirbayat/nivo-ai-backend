import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { fa } from '../i18n/fa'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Kavenegar = require('kavenegar')

// خطاهای شبکه/DNS موقتی (نه خطای واقعی کاوه‌نگار) — با یک یا دو تلاش مجدد معمولاً برطرف می‌شوند
const TRANSIENT_ERROR_CODES = new Set([
  'ENOTFOUND',
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'EAI_AGAIN',
])

function isTransientNetworkError(response: any): boolean {
  const code = response?.error?.code ?? response?.error
  return typeof code === 'string' && TRANSIENT_ERROR_CODES.has(code)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name)
  private readonly api: any
  private readonly template: string
  private readonly devMode: boolean
  private readonly maxRetries = 2
  private readonly retryDelayMs = 800

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('KAVENEGAR_API_KEY', '')
    this.template = this.config.get<string>('KAVENEGAR_TEMPLATE', 'registerverify')
    this.devMode = this.config.get<string>('SEND_SMS', 'false') !== 'true'

    if (!this.devMode) {
      this.api = Kavenegar.KavenegarApi({ apikey: apiKey })
    }
  }

  private callVerifyLookup(params: Record<string, unknown>): Promise<{ status: number; response: any }> {
    return new Promise(resolve => {
      this.api.VerifyLookup(params, (response: any, status: number) => resolve({ status, response }))
    })
  }

  private async sendWithRetry(params: Record<string, unknown>, logLabel: string): Promise<void> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const { status, response } = await this.callVerifyLookup(params)

      if (status === 200) {
        this.logger.log(`${logLabel} sent to ${params['receptor']}`)
        return
      }

      const canRetry = attempt < this.maxRetries && isTransientNetworkError(response)
      this.logger.error(
        `Kavenegar error — status: ${status}${canRetry ? ` (retrying, attempt ${attempt + 1}/${this.maxRetries})` : ''}`,
        response,
      )

      if (!canRetry) throw new InternalServerErrorException(fa.sms.sendFailed)
      await sleep(this.retryDelayMs * (attempt + 1))
    }
  }

  async sendOtp(receptor: string, code: string): Promise<void> {
    if (this.devMode) {
      this.logger.warn(
        `🔑 OTP ══════════════════ ${receptor}  →  ${code} ══════════════════`,
      )
      return
    }

    await this.sendWithRetry({ receptor, token: code, template: this.template }, 'OTP')
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

    await this.sendWithRetry({ receptor, template, ...tokens }, `SMS (${template})`)
  }
}
