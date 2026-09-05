import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtGuard } from '../../common/guards/jwt.guard';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { VideoStudioService } from './video-studio.service';
import { CreateVideoProjectDto } from './dto/create-project.dto';
import { SetVideoStudioModelsDto } from './dto/set-models.dto';
import { GenerateStoryboardDto } from './dto/generate-storyboard.dto';
import { UpdateShotDto } from './dto/update-shot.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { GenerateSimpleVideoDto } from './dto/generate-simple-video.dto';
import { UploadVideoStudioImageDto } from './dto/upload-image.dto';
import { mimeTypeForExt } from '../../common/validators/chat-image.validator';

// mimeTypeForExt (chat-image.validator.ts) فقط فرمت‌های عکس چت را می‌شناسد — اینجا mp4
// (تنها فرمت خروجی ویدیوی این فیچر) هم جدا اضافه می‌شود تا <video> فرانت بتواند Content-Type
// درست را برای seek/پخش تشخیص دهد، بدون دست‌زدن به آن فایل مشترک
function mimeTypeForVideoStudioExt(ext: string): string {
  return ext.toLowerCase() === 'mp4' ? 'video/mp4' : mimeTypeForExt(ext);
}

// docs/PRD-video-studio-chat-flow.md — استودیوی ویدیو (فلوی چت‌محور، بدون wizard/استپر)
@Controller('video-studio')
@UseGuards(JwtGuard)
export class VideoStudioController {
  constructor(private readonly videoStudio: VideoStudioService) {}

  // فاز اول ساده‌شده (دستور صریح کاربر): متن + عکس اختیاری + مدل + سایز → مستقیم یک ویدیو،
  // بدون رفتن از لایه‌ی چت/تشخیص intent. خروجی projectId/shotId برای پولینگ همان
  // GET projects/:id/shots/:shotId/video-status موجود است.
  @Post('simple/generate')
  generateSimpleVideo(
    @CurrentUser() user: JwtPayload,
    @Body() dto: GenerateSimpleVideoDto,
  ) {
    return this.videoStudio.generateSimpleVideo(user.sub, dto);
  }

  @Post('projects')
  createProject(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoProjectDto,
  ) {
    return this.videoStudio.createProject(user.sub, dto);
  }

  @Get('projects')
  listMyProjects(@CurrentUser() user: JwtPayload) {
    return this.videoStudio.listMyProjects(user.sub);
  }

  // آیکون نوتیف هدر (وب) — لیست شات‌های اخیراً تمام‌شده‌ی کاربر، برای دراپ‌داون + بج شمارنده
  @Get('notifications')
  listNotifications(@CurrentUser() user: JwtPayload) {
    return this.videoStudio.listNotifications(user.sub);
  }

  // بدنه‌ی خالی/بدون shotId یعنی «همه را دیده‌شده علامت بزن» (باز شدن دراپ‌داون)
  @Post('notifications/seen')
  markNotificationsSeen(
    @CurrentUser() user: JwtPayload,
    @Body() body: { shotId?: string },
  ) {
    return this.videoStudio.markNotificationsSeen(user.sub, body?.shotId);
  }

  @Get('projects/:id')
  getProject(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.videoStudio.getProject(user.sub, id);
  }

  @Patch('projects/:id/models')
  setModels(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SetVideoStudioModelsDto,
  ) {
    return this.videoStudio.setModels(user.sub, id, dto);
  }

  @Post('projects/:id/characters')
  generateCharacters(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.videoStudio.generateCharacterOptions(user.sub, id);
  }

  @Post('projects/:id/characters/regenerate')
  regenerateCharacters(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.videoStudio.generateCharacterOptions(user.sub, id);
  }

  @Post('projects/:id/characters/:optionId/select')
  selectCharacter(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('optionId') optionId: string,
  ) {
    return this.videoStudio.selectCharacter(user.sub, id, optionId);
  }

  @Post('projects/:id/storyboard')
  generateStoryboard(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: GenerateStoryboardDto,
  ) {
    return this.videoStudio.generateStoryboard(user.sub, id, dto);
  }

  @Patch('projects/:id/shots/:shotId')
  updateShot(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('shotId') shotId: string,
    @Body() dto: UpdateShotDto,
  ) {
    return this.videoStudio.updateShot(user.sub, id, shotId, dto);
  }

  @Post('projects/:id/shots/:shotId/video')
  requestShotVideo(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('shotId') shotId: string,
  ) {
    return this.videoStudio.requestShotVideo(user.sub, id, shotId);
  }

  @Get('projects/:id/shots/:shotId/video-status')
  getShotVideoStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('shotId') shotId: string,
  ) {
    return this.videoStudio.getShotVideoStatus(user.sub, id, shotId);
  }

  // چت واقعی، نه اسکریپت ثابت — پیام آزاد کاربر می‌آید، video-studio.service.ts/sendMessage
  // خودش intent را تشخیص می‌دهد و اکشن مناسب (تولید کاراکتر/استوری‌برد/ویدیوی مستقیم) را
  // اجرا یا فقط پاسخ می‌دهد
  @Post('projects/:id/messages')
  sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.videoStudio.sendMessage(user.sub, id, dto);
  }

  @Get('projects/:id/messages')
  listMessages(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.videoStudio.listMessages(user.sub, id);
  }

  // «افزودن عکس» توی کامپوزر — قبل از ارسال پیام صدا زده می‌شود؛ کلید برگشتی در
  // SendMessageDto.imageKey فرستاده می‌شود (دقیقاً الگوی discovery/upload-image)
  @Post('upload-image')
  uploadImage(@Body() dto: UploadVideoStudioImageDto) {
    return this.videoStudio.uploadImage(dto.image);
  }

  // فرانت با axios (هدر Authorization واقعی) + responseType:'blob' صدا می‌زند — دقیقاً الگوی
  // discovery.controller.ts/getImage؛ SkipThrottle چون گالری چند آیتم را هم‌زمان فچ می‌کند.
  // StorageService.uploadImage کلید را گاهی با پیشوند پوشه می‌سازد (`${projectId}/${uuid}.${ext}`،
  // برای عکس/ویدیوی تولیدشده‌ی داخل یک پروژه) و گاهی بدون پیشوند (`${uuid}.${ext}`، مسیر
  // upload-image خام قبل از اینکه پیام/پروژه‌ای در کار باشد — video-studio.service.ts:694) —
  // پس تعداد سگمنت‌های کلید ثابت نیست. یک `:key` تکی با path-to-regexp اسلش را match نمی‌کند
  // (تست شد: نسخه‌ی ۸.۴.۲ نصب‌شده روی `/assets/:key` برای `/assets/a/b.mp4` مستقیماً false
  // برمی‌گرداند و NestJS اصلاً route را match نمی‌کند → «Cannot GET»)، پس از wildcard چندسگمنتی
  // استفاده می‌کنیم که هم ۱ و هم ۲+ سگمنت را می‌گیرد.
  @SkipThrottle()
  @Get('assets/*key')
  async getAsset(
    @CurrentUser() user: JwtPayload,
    @Param('key') keySegments: string[],
    @Res() res: Response,
  ) {
    const { buffer, ext } = await this.videoStudio.getAsset(
      user.sub,
      keySegments.join('/'),
    );
    res.setHeader('Content-Type', mimeTypeForVideoStudioExt(ext));
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(buffer);
  }
}
