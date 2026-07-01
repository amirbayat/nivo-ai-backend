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
}
