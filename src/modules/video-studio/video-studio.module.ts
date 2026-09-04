import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { VideoStudioController } from './video-studio.controller';
import { VideoStudioService } from './video-studio.service';
import { UsageModule } from '../usage/usage.module';
import { ImageGenerationModule } from '../../common/services/image-generation.module';
import { LiaraModule } from '../liara/liara.module';
import { VideoStudioConfigModule } from '../video-studio-config/video-studio-config.module';

@Module({
  imports: [
    UsageModule,
    ImageGenerationModule,
    LiaraModule,
    VideoStudioConfigModule,
    // ثبت مجدد همین صف در ماژول تولیدکننده (پردازشگرش در queue.module.ts است) — الگوی
    // استاندارد Bull/Nest برای چند-ماژولی؛ هر دو به یک صف Redis واحد وصل می‌شوند
    BullModule.registerQueue({ name: 'studio-video-generation' }),
  ],
  controllers: [VideoStudioController],
  providers: [VideoStudioService],
})
export class VideoStudioModule {}
