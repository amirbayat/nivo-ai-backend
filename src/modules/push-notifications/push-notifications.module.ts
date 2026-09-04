import { Module } from '@nestjs/common';
import { PushNotificationsController } from './push-notifications.controller';
import { PushNotificationsService } from './push-notifications.service';
import { PushFcmService } from './fcm.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { FirebaseModule } from '../../common/firebase/firebase.module';

@Module({
  imports: [PrismaModule, FirebaseModule],
  controllers: [PushNotificationsController],
  providers: [PushNotificationsService, PushFcmService],
  // docs/PRD-video-studio-chat-flow.md §۸.۶.۵ — پردازشگر صف ویدیو (queue.module.ts) مستقیم به
  // PushFcmService نیاز دارد تا بعد از تکمیل job به همان کاربر پوش بفرستد (نه broadcast ادمین)
  exports: [PushFcmService],
})
export class PushNotificationsModule {}
