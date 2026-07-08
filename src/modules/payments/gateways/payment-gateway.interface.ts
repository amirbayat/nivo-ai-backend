import { PaymentProvider } from '@prisma/client'

export interface CreatePaymentParams {
  amount: number // ریال
  description: string
  callbackUrl: string
  mobile?: string
}

export interface CreatePaymentResult {
  providerRef: string // authority (زرین‌پال)، token (وندار) یا trackId (زیبال)
  paymentUrl: string
}

export interface VerifyPaymentParams {
  amount: number
  providerRef: string
}

export interface VerifyPaymentResult {
  success: boolean
  refId: string | null
}

export interface CallbackQuery {
  providerRef: string
  success: boolean
}

export interface PaymentGateway {
  readonly name: PaymentProvider
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>
  verifyPayment(params: VerifyPaymentParams): Promise<VerifyPaymentResult>
  /** پارس کردن query params برگشتی از درگاه — هر درگاه فرمت خودش را دارد */
  parseCallback(query: Record<string, string>): CallbackQuery
}

export const PAYMENT_GATEWAY_NAMES = ['ZARINPAL', 'VANDAR', 'ZIBAL'] as const
