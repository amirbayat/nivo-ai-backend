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

interface ZarinpalRequestResponse {
  data: { authority: string; fee: number; code: number }
  errors: unknown[]
}

interface ZarinpalVerifyResponse {
  data: { ref_id: number; code: number; card_hash: string }
  errors: unknown[]
}

@Injectable()
export class ZarinpalGateway implements PaymentGateway {
  readonly name = PaymentProvider.ZARINPAL

  private readonly logger = new Logger(ZarinpalGateway.name)
  private readonly merchantId: string
  private readonly baseUrl = 'https://api.zarinpal.com/pg/v4/payment'
  private readonly gatewayUrl = 'https://www.zarinpal.com/pg/StartPay'

  constructor(private readonly config: ConfigService) {
    this.merchantId = this.config.get<string>('ZARINPAL_MERCHANT_ID')!
  }

  async createPayment({ amount, description, callbackUrl }: CreatePaymentParams): Promise<CreatePaymentResult> {
    const body = {
      merchant_id: this.merchantId,
      amount,
      description,
      callback_url: callbackUrl,
    }
    this.logger.log(`request → ${JSON.stringify({ ...body, merchant_id: maskSecret(body.merchant_id) })}`)

    const res = await fetch(`${this.baseUrl}/request.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })

    const json = (await res.json()) as ZarinpalRequestResponse
    this.logger.log(`request ← status=${res.status} body=${JSON.stringify(json)}`)

    if (!res.ok || json.data?.code !== 100) {
      throw new InternalServerErrorException(fa.payment.gatewayError)
    }

    return {
      providerRef: json.data.authority,
      paymentUrl: `${this.gatewayUrl}/${json.data.authority}`,
    }
  }

  async verifyPayment({ amount, providerRef }: VerifyPaymentParams): Promise<VerifyPaymentResult> {
    const body = {
      merchant_id: this.merchantId,
      amount,
      authority: providerRef,
    }
    this.logger.log(`verify → ${JSON.stringify({ ...body, merchant_id: maskSecret(body.merchant_id) })}`)

    const res = await fetch(`${this.baseUrl}/verify.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })

    const json = (await res.json()) as ZarinpalVerifyResponse
    this.logger.log(`verify ← status=${res.status} body=${JSON.stringify(json)}`)

    // code 100 = success, code 101 = already verified (idempotent)
    if (!res.ok || (json.data?.code !== 100 && json.data?.code !== 101)) {
      return { success: false, refId: null }
    }

    return { success: true, refId: String(json.data.ref_id) }
  }

  parseCallback(query: Record<string, string>): CallbackQuery {
    this.logger.log(`callback query → ${JSON.stringify(query)}`)
    return { providerRef: query.Authority, success: query.Status === 'OK' }
  }
}
