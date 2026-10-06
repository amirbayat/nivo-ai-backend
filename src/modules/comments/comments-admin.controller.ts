import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { CommentStatus } from '@prisma/client';
import type { Response } from 'express';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CommentsService } from './comments.service';
import { ModerateCommentDto } from './dto/moderate-comment.dto';
import { StorageService } from '../../storage/storage.service';
import { mimeTypeForExt } from '../../common/validators/chat-image.validator';

const VALID_STATUSES: CommentStatus[] = [
  'PENDING',
  'AI_AUTO_REJECTED',
  'ADMIN_APPROVED',
  'ADMIN_REJECTED',
];

// docs/PRD-customer-comments-and-discounts.md بخش ۵ — صف تعدیل مرکزی، فقط ادمین پلتفرم
// (همان الگوی message-feedback.controller.ts)
@Controller('admin/comments')
@UseGuards(JwtGuard, AdminGuard)
export class CommentsAdminController {
  constructor(
    private readonly comments: CommentsService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('storeId') storeId?: string,
  ) {
    const statusFilter = VALID_STATUSES.includes(status as CommentStatus)
      ? (status as CommentStatus)
      : undefined;
    return this.comments.listForAdmin(
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
      statusFilter,
      storeId,
    );
  }

  @Patch(':id/moderate')
  moderate(@Param('id') id: string, @Body() dto: ModerateCommentDto) {
    return this.comments.moderate(id, dto.status);
  }

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۴.۲ — پیش‌نمایش رسانه‌ی
  // نظر برای ادمین حتی وقتی هنوز PENDING است (ادمین دقیقاً باید همین را ببیند تا تصمیم بگیرد)؛
  // برخلاف سرو عمومی خریدار (sales-agent.controller.ts's getReviewMedia)، Range پشتیبانی
  // نمی‌شود — یک ابزار داخلی پیش‌نمایش است، نه پخش‌کننده‌ی ویترین
  @Get(':id/media/:key')
  async getMedia(
    @Param('id') id: string,
    @Param('key') key: string,
    @Res() res: Response,
  ) {
    const kind = await this.comments.assertReviewMediaKeyForAdmin(id, key);
    const ext = key.split('.').pop() ?? '';
    const buffer = await this.storage.downloadImage(key);
    const mimeType =
      kind === 'image'
        ? mimeTypeForExt(ext)
        : kind === 'audio'
          ? `audio/${ext === 'mp3' ? 'mpeg' : ext}`
          : `video/${ext}`;
    res.setHeader('Content-Type', mimeType);
    res.send(buffer);
  }
}
