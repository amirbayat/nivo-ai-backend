import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
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
import { maskSecret } from './redact'

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

  private readonly logger = new Logger(ZibalGateway.name)
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
    const body = {
      merchant: this.merchantId,
      amount,
      callbackUrl,
      description,
      ...(mobile ? { mobile } : {}),
    }
    this.logger.log(`request → ${JSON.stringify({ ...body, merchant: maskSecret(body.merchant) })}`)

    const res = await fetch(`${this.baseUrl}/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })

    const json = (await res.json()) as ZibalRequestResponse
    this.logger.log(`request ← status=${res.status} body=${JSON.stringify(json)}`)

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
    const body = { merchant: this.merchantId, trackId: Number(providerRef) }
    this.logger.log(`verify → ${JSON.stringify({ ...body, merchant: maskSecret(body.merchant) })}`)

    const res = await fetch(`${this.baseUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })

    const json = (await res.json()) as ZibalVerifyResponse
    this.logger.log(`verify ← status=${res.status} body=${JSON.stringify(json)}`)

    // result 100 = موفق، 201 = قبلاً تایید شده (idempotent)
    if (!res.ok || (json.result !== 100 && json.result !== 201) || !json.refNumber) {
      return { success: false, refId: null }
    }

    return { success: true, refId: String(json.refNumber) }
  }

  parseCallback(query: Record<string, string>): CallbackQuery {
    this.logger.log(`callback query → ${JSON.stringify(query)}`)
    return { providerRef: query.trackId, success: query.success === '1' || query.success === '2' }
  }
}
