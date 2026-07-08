import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PaymentProvider } from '@prisma/client'
import { fa } from '../../../i18n/fa'
import { PAYMENT_GATEWAY_NAMES, PaymentGateway } from './payment-gateway.interface'
import { ZarinpalGateway } from './zarinpal.gateway'
import { VandarGateway } from './vandar.gateway'
import { ZibalGateway } from './zibal.gateway'

@Injectable()
export class PaymentGatewayRegistry implements OnModuleInit {
  private readonly gateways: Record<PaymentProvider, PaymentGateway>
  private enabled: PaymentProvider[] = []

  constructor(
    private readonly config: ConfigService,
    zarinpal: ZarinpalGateway,
    vandar: VandarGateway,
    zibal: ZibalGateway,
  ) {
    this.gateways = { ZARINPAL: zarinpal, VANDAR: vandar, ZIBAL: zibal }
  }

  onModuleInit() {
    const raw = (this.config.get<string>('PAYMENT_GATEWAYS') ?? '').trim()
    if (!raw) throw new Error('PAYMENT_GATEWAYS تنظیم نشده است')

    const names = raw.split(',').map((s) => s.trim().toUpperCase())
    for (const n of names) {
      if (!(PAYMENT_GATEWAY_NAMES as readonly string[]).includes(n)) {
        throw new Error(`درگاه ناشناخته در PAYMENT_GATEWAYS: ${n}`)
      }
    }
    this.enabled = names as PaymentProvider[]

    if (this.enabled.includes('ZARINPAL') && !this.config.get('ZARINPAL_MERCHANT_ID')) {
      throw new Error('ZARINPAL_MERCHANT_ID تنظیم نشده ولی zarinpal در PAYMENT_GATEWAYS فعال است')
    }
    if (this.enabled.includes('VANDAR') && !this.config.get('VANDAR_API_KEY')) {
      throw new Error('VANDAR_API_KEY تنظیم نشده ولی vandar در PAYMENT_GATEWAYS فعال است')
    }
    const zibalTestMode = this.config.get<string>('ZIBAL_TEST', 'false') === 'true'
    if (this.enabled.includes('ZIBAL') && !zibalTestMode && !this.config.get('ZIBAL_MERCHANT_ID')) {
      throw new Error('ZIBAL_MERCHANT_ID تنظیم نشده ولی zibal در PAYMENT_GATEWAYS فعال است (یا ZIBAL_TEST=true بگذارید)')
    }
  }

  getEnabled(): PaymentProvider[] {
    return this.enabled
  }

  /** اگر فقط یک درگاه فعال باشد، همیشه همان برگردانده می‌شود (requested نادیده گرفته می‌شود) */
  resolve(requested?: PaymentProvider): PaymentGateway {
    if (this.enabled.length === 1) return this.gateways[this.enabled[0]]
    if (!requested) throw new BadRequestException(fa.payment.gatewayRequired)
    if (!this.enabled.includes(requested)) throw new BadRequestException(fa.payment.gatewayNotEnabled)
    return this.gateways[requested]
  }

  byName(name: PaymentProvider): PaymentGateway {
    return this.gateways[name]
  }
}
