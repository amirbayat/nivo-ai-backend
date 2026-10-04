import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import type { CommentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type ProductCommentModerationJobData = { commentId: string };

// docs/PRD-customer-comments-and-discounts.md بخش الف — نظرات خریداران؛ تایید نهایی همیشه با
// ادمین پلتفرم است، AI فقط پیش‌فیلتر برای کم‌کردن حجم صف است (product-comment-moderation.processor.ts)
@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('product-comment-moderation')
    private readonly moderationQueue: Queue<ProductCommentModerationJobData>,
  ) {}

  // از conversation-engine.service.ts's doSubmitComment صدا زده می‌شود — بعد از سفارش تاییدشده،
  // اولین پیام آزاد مشتری در پاسخ به پیگیری «راضی بودی؟» همین متن می‌شود
  async submitComment(input: {
    storeId: string;
    customerId: string;
    productId: string | null;
    text: string;
    rating?: number;
  }): Promise<void> {
    const comment = await this.prisma.productComment.create({
      data: {
        storeId: input.storeId,
        customerId: input.customerId,
        productId: input.productId,
        text: input.text,
        rating: input.rating,
      },
    });
    await this.moderationQueue.add('moderate', { commentId: comment.id });
  }

  // فقط برای doFaq/showProduct (نمایش به خریدار بعدی) و store-kb.service.ts's completeProductInfo
  // (منبع کمکی توضیحات §۶) — همیشه فقط نظرات ADMIN_APPROVED
  async getApprovedForProduct(productId: string, limit = 3) {
    return this.prisma.productComment.findMany({
      where: { productId, status: 'ADMIN_APPROVED' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { text: true, rating: true },
    });
  }

  // صف تعدیل پنل ادمین (docs/PRD-customer-comments-and-discounts.md بخش ۵) — همان الگوی
  // pagination-ی MessageFeedbackService.getAll
  async listForAdmin(
    page = 1,
    limit = 20,
    status?: CommentStatus,
    storeId?: string,
  ) {
    const skip = (page - 1) * limit;
    const where = {
      ...(status ? { status } : {}),
      ...(storeId ? { storeId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.productComment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          store: { select: { name: true } },
          product: { select: { name: true } },
        },
      }),
      this.prisma.productComment.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async moderate(id: string, status: 'ADMIN_APPROVED' | 'ADMIN_REJECTED') {
    return this.prisma.productComment.update({
      where: { id },
      data: { status, moderatedAt: new Date() },
    });
  }
}
