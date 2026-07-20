import { Module } from '@nestjs/common'
import { LiaraManagementService } from './liara-management.service'
import { LiaraKeyProvisioningService } from './liara-key-provisioning.service'

@Module({
  providers: [LiaraManagementService, LiaraKeyProvisioningService],
  exports: [LiaraManagementService, LiaraKeyProvisioningService],
})
export class LiaraModule {}
