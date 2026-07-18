import { Module } from '@nestjs/common'
import { PaymentsService } from './payments.service'
import { PaymentsController } from './payments.controller'
import { PaymentGatewayRegistry } from './gateways/payment-gateway.registry'
import { ZarinpalGateway } from './gateways/zarinpal.gateway'
import { VandarGateway } from './gateways/vandar.gateway'
import { ZibalGateway } from './gateways/zibal.gateway'
import { UsageModule } from '../usage/usage.module'
import { GrowthModule } from '../growth/growth.module'
import { AdminNotificationsModule } from '../admin-notifications/admin-notifications.module'

@Module({
  imports: [UsageModule, GrowthModule, AdminNotificationsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentGatewayRegistry, ZarinpalGateway, VandarGateway, ZibalGateway],
})
export class PaymentsModule {}
