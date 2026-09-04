import { Module } from '@nestjs/common';
import { VideoGenerationService } from './video-generation.service';

@Module({
  providers: [VideoGenerationService],
  exports: [VideoGenerationService],
})
export class VideoGenerationModule {}
