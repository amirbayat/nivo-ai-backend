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

interface VandarSendResponse {
  status: number
  token?: string
  message?: string
}

interface VandarVerifyResponse {
  status: number
  transId?: number
  message?: string
}

@Injectable()
export class VandarGateway implements PaymentGateway {
  readonly name = PaymentProvider.VANDAR

  private readonly logger = new Logger(VandarGateway.name)
  private readonly apiKey: string
  private readonly baseUrl = 'https://ipg.vandar.io/api/v4'
  private readonly gatewayUrl = 'https://ipg.vandar.io/v4'

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('VANDAR_API_KEY')!
  }

  async createPayment({ amount, description, callbackUrl, mobile }: CreatePaymentParams): Promise<CreatePaymentResult> {
    const body = {
      api_key: this.apiKey,
      amount,
      callback_url: callbackUrl,
      description,
      ...(mobile ? { mobile_number: mobile } : {}),
    }
    this.logger.log(`send → ${JSON.stringify({ ...body, api_key: maskSecret(body.api_key) })}`)

    const res = await fetch(`${this.baseUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })

    const json = (await res.json()) as VandarSendResponse
    this.logger.log(`send ← status=${res.status} body=${JSON.stringify(json)}`)

    if (!res.ok || json.status !== 1 || !json.token) {
      throw new InternalServerErrorException(fa.payment.gatewayError)
    }

    return {
      providerRef: json.token,
      paymentUrl: `${this.gatewayUrl}/${json.token}`,
    }
  }

  // نکته: بر خلاف زرین‌پال، وندار مبلغ را در verify نمی‌گیرد (فقط api_key + token)
  async verifyPayment({ providerRef }: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const body = { api_key: this.apiKey, token: providerRef }
    this.logger.log(`verify → ${JSON.stringify({ ...body, api_key: maskSecret(body.api_key) })}`)

    const res = await fetch(`${this.baseUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })

    const json = (await res.json()) as VandarVerifyResponse
    this.logger.log(`verify ← status=${res.status} body=${JSON.stringify(json)}`)

    if (!res.ok || json.status !== 1) {
      return { success: false, refId: null }
    }

    return { success: true, refId: String(json.transId) }
  }

  parseCallback(query: Record<string, string>): CallbackQuery {
    this.logger.log(`callback query → ${JSON.stringify(query)}`)
    return { providerRef: query.token, success: query.payment_status === 'OK' }
  }
}
