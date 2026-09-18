import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { VideoEditController } from './video-edit.controller';
import { VideoEditWebhookController } from './video-edit-webhook.controller';
import { VideoEditService } from './video-edit.service';
import { VideoEditWebhookService } from './video-edit-webhook.service';
import { UsageModule } from '../usage/usage.module';
import { CreditsModule } from '../credits/credits.module';
import { MediaTranscodeModule } from '../../common/services/media-transcode.module';
import { KieVideoModelsModule } from '../kie-video-models/kie-video-models.module';
import { VideoEditConfigModule } from '../video-edit-config/video-edit-config.module';
import { VeoProviderModule } from '../../common/services/veo-provider.module';
import { RunwayProviderModule } from '../../common/services/runway-provider.module';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';

@Module({
  imports: [
    UsageModule,
    CreditsModule,
    MediaTranscodeModule,
    KieVideoModelsModule,
    VideoEditConfigModule,
    VeoProviderModule,
    RunwayProviderModule,
    PushNotificationsModule,
    // ثبت مجدد همین صف در ماژول تولیدکننده (پردازشگرش در queue.module.ts است) — الگوی
    // استاندارد Bull/Nest، دقیقاً مثل video-studio.module.ts. lockDuration هم‌راستا با
    // queue.module.ts نگه‌داشته می‌شود (job تا ~۱۱۰ دقیقه برای Veo poll می‌کند —
    // video-edit.processor.ts/EXTRA_GRACE_POLL_ATTEMPTS_VEO)
    BullModule.registerQueue({
      name: 'video-edit',
      settings: { lockDuration: 120 * 60 * 1000 },
    }),
  ],
  controllers: [VideoEditController, VideoEditWebhookController],
  providers: [VideoEditService, VideoEditWebhookService],
})
export class VideoEditModule {}
