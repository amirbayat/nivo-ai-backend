import { Injectable, InternalServerErrorException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PaymentProvider } from '@prisma/client'
import { fa } from '../../../i18n/fa'
import {
  CallbackQuery,
  CreatePaymentParams,
  CreatePaymentResult,
  PaymentGateway,
  VerifyPaymentParams,
  VerifyPaymentResult,
} from './payment-gateway.interface'

interface ZibalRequestResponse {
  result: number
  trackId?: number
  message?: string
}

interface ZibalVerifyResponse {
  result: number
  refNumber?: string
  message?: string
}

@Injectable()
export class ZibalGateway implements PaymentGateway {
  readonly name = PaymentProvider.ZIBAL

  private readonly merchantId: string
  private readonly baseUrl = 'https://gateway.zibal.ir/v1'
  private readonly gatewayUrl = 'https://gateway.zibal.ir/start'

  constructor(private readonly config: ConfigService) {
    // طبق راهنمای پشتیبانی زیبال: برای تست درگاه بدون merchant واقعی، مقدار merchant را «zibal» بگذارید
    // (حتماً باید lowercase باشد — با تست مستقیم روی API واقعی تأیید شد؛ "ZIBAL" با result:104 رد می‌شود)
    const isTestMode = this.config.get<string>('ZIBAL_TEST', 'false') === 'true'
    this.merchantId = isTestMode ? 'zibal' : this.config.get<string>('ZIBAL_MERCHANT_ID')!
  }

  async createPayment({ amount, description, callbackUrl, mobile }: CreatePaymentParams): Promise<CreatePaymentResult> {
    const res = await fetch(`${this.baseUrl}/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        merchant: this.merchantId,
        amount,
        callbackUrl,
        description,
        ...(mobile ? { mobile } : {}),
      }),
    })

    const json = (await res.json()) as ZibalRequestResponse

    if (!res.ok || json.result !== 100 || !json.trackId) {
      throw new InternalServerErrorException(fa.payment.gatewayError)
    }

    return {
      providerRef: String(json.trackId),
      paymentUrl: `${this.gatewayUrl}/${json.trackId}`,
    }
  }

  // نکته: زیبال هم مثل وندار مبلغ را در verify نمی‌گیرد (فقط merchant + trackId)
  async verifyPayment({ providerRef }: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const res = await fetch(`${this.baseUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        merchant: this.merchantId,
        trackId: Number(providerRef),
      }),
    })

    const json = (await res.json()) as ZibalVerifyResponse

    // result 100 = موفق، 201 = قبلاً تایید شده (idempotent)
    if (!res.ok || (json.result !== 100 && json.result !== 201) || !json.refNumber) {
      return { success: false, refId: null }
    }

    return { success: true, refId: String(json.refNumber) }
  }

  parseCallback(query: Record<string, string>): CallbackQuery {
    return { providerRef: query.trackId, success: query.success === '1' || query.success === '2' }
  }
}
