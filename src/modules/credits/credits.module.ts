import { Module } from '@nestjs/common'
import { CreditsController } from './credits.controller'
import { CreditsService } from './credits.service'
import { UsageModule } from '../usage/usage.module'
import { PaymentsModule } from '../payments/payments.module'

@Module({
  imports: [UsageModule, PaymentsModule],
  controllers: [CreditsController],
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
