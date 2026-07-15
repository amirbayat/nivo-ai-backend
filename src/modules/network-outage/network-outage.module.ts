import { Module } from '@nestjs/common'
import { NetworkOutageService } from './network-outage.service'
import { NetworkOutageController, NetworkOutagePublicController } from './network-outage.controller'

@Module({
  controllers: [NetworkOutagePublicController, NetworkOutageController],
  providers: [NetworkOutageService],
})
export class NetworkOutageModule {}
