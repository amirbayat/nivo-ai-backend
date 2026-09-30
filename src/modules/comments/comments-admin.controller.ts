import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { CommentStatus } from '@prisma/client';
import { JwtGuard } from '../../common/guards/jwt.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CommentsService } from './comments.service';
import { ModerateCommentDto } from './dto/moderate-comment.dto';

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
  constructor(private readonly comments: CommentsService) {}

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
}
