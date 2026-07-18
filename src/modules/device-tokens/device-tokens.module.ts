import { Module } from '@nestjs/common'
import { DeviceTokensController } from './device-tokens.controller'
import { DeviceTokensService } from './device-tokens.service'
import { PrismaModule } from '../../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [DeviceTokensController],
  providers: [DeviceTokensService],
  exports: [DeviceTokensService],
})
export class DeviceTokensModule {}
