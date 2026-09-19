import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { StorageService } from '../../storage/storage.service';
import { CONTENT_AGENT_PUBLIC_IMAGE_PREFIX } from './content-agent.service';

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

// بدون ApiKeyGuard عمداً — این همان عکس‌هایی است که با POST /content-agent/images (پشت
// Guard) آپلود شده و قرار است در صفحه‌ی عمومی /blog دیده شود؛ کنترل دسترسی سمت نوشتن است،
// نه خواندن. کنترلر جدا از content-agent-ingest.controller.ts چون آن کلاس @UseGuards(ApiKeyGuard)
// روی کل کنترلر است.
@Controller('content-agent')
export class ContentAgentPublicController {
  constructor(private readonly storageService: StorageService) {}

  @Get('images/:filename')
  async getImage(@Param('filename') filename: string, @Res() res: Response) {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const contentType = CONTENT_TYPES[ext];
    if (!contentType) throw new NotFoundException();

    try {
      const buffer = await this.storageService.downloadImage(
        `${CONTENT_AGENT_PUBLIC_IMAGE_PREFIX}/${filename}`,
      );
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(buffer);
    } catch {
      throw new NotFoundException();
    }
  }
}
