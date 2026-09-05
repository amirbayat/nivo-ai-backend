import { Module } from '@nestjs/common';
import { MediaTranscodeService } from './media-transcode.service';

@Module({
  providers: [MediaTranscodeService],
  exports: [MediaTranscodeService],
})
export class MediaTranscodeModule {}
