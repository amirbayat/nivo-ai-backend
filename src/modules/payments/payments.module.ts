import { Module } from '@nestjs/common'
import { PaymentsService } from './payments.service'
import { PaymentsController } from './payments.controller'
import { PaymentGatewayRegistry } from './gateways/payment-gateway.registry'
import { ZarinpalGateway } from './gateways/zarinpal.gateway'
import { VandarGateway } from './gateways/vandar.gateway'
import { ZibalGateway } from './gateways/zibal.gateway'
import { UsageModule } from '../usage/usage.module'

@Module({
  imports: [UsageModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentGatewayRegistry, ZarinpalGateway, VandarGateway, ZibalGateway],
})
export class PaymentsModule {}
