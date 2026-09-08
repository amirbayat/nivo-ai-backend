import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtGuard } from '../../common/guards/jwt.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { VideoEditService } from './video-edit.service';
import { CreateVideoEditJobDto } from './dto/create-video-edit-job.dto';
import { CreateVideoEditSessionDto } from './dto/create-video-edit-session.dto';

function mimeTypeForVideoEditExt(ext: string): string {
  if (ext.toLowerCase() === 'mov') return 'video/quicktime';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext.toLowerCase()))
    return `image/${ext}`;
  return 'video/mp4';
}

// docs/PRD-video-edit-omni-kie.md — «ویرایش ویدیو» با Kie.ai، کاملاً جدا از video-studio
// (OpenRouter). آپلود multipart (نه data-URL) دقیقاً الگوی caption-studio.controller.ts
// چون فایل ویدیو می‌تواند صدها مگابایت باشد.
@Controller('video-edit')
@UseGuards(JwtGuard)
export class VideoEditController {
  constructor(private readonly videoEdit: VideoEditService) {}

  @Get('models')
  listModels() {
    return this.videoEdit.listModels();
  }

  // مقادیر عمومی/بی‌ضرر VideoEditConfig (مدت ثابت تولید) — برای نمایش عدد واقعی در فرم،
  // نه یک برچسب مبهم «مدت ثابت»
  @Get('config')
  getPublicConfig() {
    return this.videoEdit.getPublicConfig();
  }

  @Post('upload-image')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    return this.videoEdit.uploadImage(file);
  }

  @Post('upload-video')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }),
  )
  uploadVideo(@UploadedFile() file: Express.Multer.File) {
    return this.videoEdit.uploadVideo(file);
  }

  // بازطراحی ۱۴۰۵/۰۶/۱۷ — «Session»: تاریخچه‌ی جلسه‌های ویرایش (هر session چند job دارد).
  // معمولاً لازم نیست صریح صدا زده شود چون POST jobs خودش وقتی sessionId نیامده می‌سازد؛
  // این endpoint برای وقتی UI می‌خواهد قبل از هر job واقعی «شروع ویرایش جدید» بزند مفید است
  @Get('sessions')
  listMySessions(@CurrentUser() user: JwtPayload) {
    return this.videoEdit.listMySessions(user.sub);
  }

  @Post('sessions')
  createSession(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoEditSessionDto,
  ) {
    return this.videoEdit.createSession(user.sub, dto.title);
  }

  @Post('jobs')
  createJob(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoEditJobDto,
  ) {
    return this.videoEdit.createJob(user.sub, dto);
  }

  @Get('jobs')
  listMyJobs(@CurrentUser() user: JwtPayload) {
    return this.videoEdit.listMyJobs(user.sub);
  }

  @Get('jobs/:id')
  getJobStatus(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.videoEdit.getJobStatus(user.sub, id);
  }

  // الگوی video-studio.controller.ts/getAsset — wildcard چندسگمنتی چون کلید MinIO گاهی
  // پیشوند پوشه دارد (`${jobId}/${uuid}.ext`) و گاهی ندارد
  @SkipThrottle()
  @Get('assets/*key')
  async getAsset(
    @CurrentUser() user: JwtPayload,
    @Param('key') keySegments: string[],
    @Res() res: Response,
  ) {
    const { buffer, ext } = await this.videoEdit.getAsset(
      user.sub,
      keySegments.join('/'),
    );
    res.setHeader('Content-Type', mimeTypeForVideoEditExt(ext));
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(buffer);
  }
}
