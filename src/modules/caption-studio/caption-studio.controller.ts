import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { CaptionStudioService, type SubtitleExportFormat } from './caption-studio.service';
import { UpdateCaptionProjectDto } from './dto/update-caption-project.dto';

const EXPORT_FORMATS: SubtitleExportFormat[] = ['srt', 'vtt', 'ass'];

function mimeTypeForCaptionExt(ext: string): string {
  return ext.toLowerCase() === 'mov' ? 'video/quicktime' : 'video/mp4';
}

// docs/PRD-video-auto-captions.md §۱۱/§۱۸ — آپلود ویدیوی مبدأ multipart (نه data-URL base64
// مثل عکس‌های موجود پروژه، چون فایل ویدیو می‌تواند صدها مگابایت باشد؛ §۷)
@Controller('caption-studio')
@UseGuards(JwtGuard)
export class CaptionStudioController {
  constructor(private readonly captionStudio: CaptionStudioService) {}

  @Post('projects')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 500 * 1024 * 1024 } }))
  createProject(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.captionStudio.createProject(user.sub, file);
  }

  @Get('projects/:id')
  getProject(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.captionStudio.getProject(user.sub, id);
  }

  // autosave (بخش ۵.۳) — فرانت فقط فیلدهای واقعاً تغییرکرده را می‌فرستد
  @Patch('projects/:id')
  updateProject(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCaptionProjectDto,
  ) {
    return this.captionStudio.updateProject(user.sub, id, dto);
  }

  @Post('projects/:id/retry')
  retryTranscription(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.captionStudio.retryTranscription(user.sub, id);
  }

  @Post('projects/:id/render')
  startRender(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.captionStudio.startRender(user.sub, id);
  }

  // خروجی فایل زیرنویس خام (بخش ۸.۲) — دانلود مستقیم با Content-Disposition
  @Get('projects/:id/export')
  async exportSubtitles(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    if (!EXPORT_FORMATS.includes(format as SubtitleExportFormat)) {
      throw new BadRequestException('فرمت باید یکی از srt/vtt/ass باشد');
    }
    const { content, mime, ext } = await this.captionStudio.exportSubtitles(
      user.sub,
      id,
      format as SubtitleExportFormat,
    );
    res.setHeader('Content-Type', `${mime}; charset=utf-8`);
    res.setHeader('Content-Disposition', `attachment; filename="captions.${ext}"`);
    res.send(content);
  }

  // پخش ویدیوی مبدأ/رندرشده در فرانت — دقیقاً الگوی video-studio.controller.ts/getAsset،
  // با این تفاوت که Range را هم پشتیبانی می‌کند (ویدیوهای این فیچر تا ۲۰ دقیقه‌اند؛ بدون
  // Range، پخش/seek نیاز به دانلود کامل فایل پیش از شروع دارد)
  @SkipThrottle()
  @Get('assets/*key')
  async getAsset(
    @CurrentUser() user: JwtPayload,
    @Param('key') keySegments: string[],
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    const key = keySegments.join('/');
    const { stream, ext, size, range: resolvedRange } = await this.captionStudio.getAssetStream(
      user.sub,
      key,
      range,
    );
    res.setHeader('Content-Type', mimeTypeForCaptionExt(ext));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');

    if (resolvedRange) {
      res.status(206);
      res.setHeader('Content-Range', `bytes ${resolvedRange.start}-${resolvedRange.end}/${size}`);
      res.setHeader('Content-Length', String(resolvedRange.end - resolvedRange.start + 1));
    } else {
      res.setHeader('Content-Length', String(size));
    }
    stream.pipe(res);
  }
}
