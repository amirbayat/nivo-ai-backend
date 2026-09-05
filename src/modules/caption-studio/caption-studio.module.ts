import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { CaptionStudioController } from './caption-studio.controller';
import { CaptionStudioService } from './caption-studio.service';
import { UsageModule } from '../usage/usage.module';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [
    UsageModule,
    CreditsModule,
    // ثبت مجدد همین صف در ماژول تولیدکننده (پردازشگرش در queue.module.ts است) — الگوی
    // استاندارد Bull/Nest برای چند-ماژولی (دقیقاً مثل video-studio.module.ts/studio-video-generation)؛
    // settings باید عیناً با queue.module.ts یکی باشد.
    BullModule.registerQueue({
      name: 'caption-transcribe',
      settings: { lockDuration: 10 * 60 * 1000 },
    }),
    BullModule.registerQueue({
      name: 'caption-render',
      settings: { lockDuration: 10 * 60 * 1000 },
    }),
  ],
  controllers: [CaptionStudioController],
  providers: [CaptionStudioService],
})
export class CaptionStudioModule {}
