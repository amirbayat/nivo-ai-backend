import { Module } from '@nestjs/common'
import { SalesController } from './sales.controller'
import { SalesAdminController } from './sales-admin.controller'
import { SalesService } from './sales.service'
import { SalesAdminService } from './sales-admin.service'
import { SalesConfigService } from './sales-config.service'
import { SalesKbService } from './sales-kb.service'
import { PrismaModule } from '../../prisma/prisma.module'
import { UsageModule } from '../usage/usage.module'
import { SmsModule } from '../../sms/sms.module'

@Module({
  imports: [PrismaModule, UsageModule, SmsModule],
  controllers: [SalesController, SalesAdminController],
  providers: [SalesService, SalesAdminService, SalesConfigService, SalesKbService],
})
export class SalesModule {}
