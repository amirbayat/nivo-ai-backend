import { Module } from '@nestjs/common'
import { AdminNotificationsController } from './admin-notifications.controller'
import { AdminNotificationsService } from './admin-notifications.service'
import { FcmService } from './fcm.service'
import { PrismaModule } from '../../prisma/prisma.module'
import { FirebaseModule } from '../../common/firebase/firebase.module'

@Module({
  imports: [PrismaModule, FirebaseModule],
  controllers: [AdminNotificationsController],
  providers: [AdminNotificationsService, FcmService],
  exports: [AdminNotificationsService],
})
export class AdminNotificationsModule {}
