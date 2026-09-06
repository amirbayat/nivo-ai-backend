import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { VideoEditController } from './video-edit.controller';
import { VideoEditService } from './video-edit.service';
import { UsageModule } from '../usage/usage.module';
import { CreditsModule } from '../credits/credits.module';
import { MediaTranscodeModule } from '../../common/services/media-transcode.module';
import { KieVideoModelsModule } from '../kie-video-models/kie-video-models.module';
import { VideoEditConfigModule } from '../video-edit-config/video-edit-config.module';

@Module({
  imports: [
    UsageModule,
    CreditsModule,
    MediaTranscodeModule,
    KieVideoModelsModule,
    VideoEditConfigModule,
    // ثبت مجدد همین صف در ماژول تولیدکننده (پردازشگرش در queue.module.ts است) — الگوی
    // استاندارد Bull/Nest، دقیقاً مثل video-studio.module.ts. lockDuration بزرگ برای همون
    // دلیل: job تا ۳۰ دقیقه poll می‌کند (video-edit.processor.ts)
    BullModule.registerQueue({
      name: 'video-edit',
      settings: { lockDuration: 35 * 60 * 1000 },
    }),
  ],
  controllers: [VideoEditController],
  providers: [VideoEditService],
})
export class VideoEditModule {}
