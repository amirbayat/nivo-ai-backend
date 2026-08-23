import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { StorageService } from '../../storage/storage.service';
import { fa } from '../../i18n/fa';

// کلید ویدیوی آموزشی nivo-cal داخل باکت اصلی — فایل ثابت مارکتینگ، مستقیم توسط تیم توی
// باکت آپلود شده (نه از مسیر uploadImage برنامه)، پس قابل override با env در صورت جابه‌جایی فایل
const TUTORIAL_VIDEO_KEY =
  process.env.NIVO_CAL_TUTORIAL_VIDEO_KEY || 'nivo-tutorial-1-2.mp4';

// مسیر عمومی (بدون JwtGuard) — دقیقاً هم‌الگوی DiscoveryPublicController.getExampleImage:
// صفحه‌ی لندینگ nivo-cal حتی برای کاربر لاگین‌نکرده باید این ویدیو را ببیند. برخلاف عکس‌های
// غذای کاربر (nivo-cal.controller.ts، پشت JwtGuard + چک مالکیت)، این یک فایل ثابت و مشترک
// بین همه‌ی بازدیدکننده‌هاست — کلید هم داخل کد ثابت است، نه ورودی کاربر.
@Controller('nivo-cal/public')
export class NivoCalPublicController {
  constructor(private readonly storage: StorageService) {}

  @SkipThrottle()
  @Get('tutorial-video')
  async tutorialVideo(
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    let size: number;
    try {
      const stat = await this.storage.statObject(TUTORIAL_VIDEO_KEY);
      size = stat.size;
    } catch {
      throw new NotFoundException(fa.errors.notFound);
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Accept-Ranges', 'bytes');

    const match = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : size - 1;
      const stream = await this.storage.getObjectStream(TUTORIAL_VIDEO_KEY, {
        start,
        end,
      });
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      stream.pipe(res);
      return;
    }

    res.setHeader('Content-Length', String(size));
    const stream = await this.storage.getObjectStream(TUTORIAL_VIDEO_KEY);
    stream.pipe(res);
  }
}
