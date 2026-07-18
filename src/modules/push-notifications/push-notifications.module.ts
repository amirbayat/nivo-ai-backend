import { Module } from '@nestjs/common'
import { PushNotificationsController } from './push-notifications.controller'
import { PushNotificationsService } from './push-notifications.service'
import { PushFcmService } from './fcm.service'
import { PrismaModule } from '../../prisma/prisma.module'
import { FirebaseModule } from '../../common/firebase/firebase.module'

@Module({
  imports: [PrismaModule, FirebaseModule],
  controllers: [PushNotificationsController],
  providers: [PushNotificationsService, PushFcmService],
})
export class PushNotificationsModule {}
