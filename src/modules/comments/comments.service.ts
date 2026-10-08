import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import type { CommentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { fa } from '../../i18n/fa';

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
  // docs/PRD-order-status-chat-tool-and-fulfillment-delay-reviews.md بخش ۳.۲ — text قبلاً
  // اجباری بود؛ نظر فقط-رسانه (مثلاً فقط یک ویس، بدون کپشن تایپی) هم باید ثبت شود، پس حالا
  // اختیاری است و فقط گارد زیر (حداقل یکی از چهار فیلد) اجرا می‌شود
  async submitComment(input: {
    storeId: string;
    customerId: string;
    productId: string | null;
    text?: string;
    rating?: number;
    imageKey?: string;
    videoKey?: string;
    audioKey?: string;
  }): Promise<void> {
    if (!input.text && !input.imageKey && !input.videoKey && !input.audioKey) {
      throw new BadRequestException(fa.errors.validation);
    }
    const comment = await this.prisma.productComment.create({
      data: {
        storeId: input.storeId,
        customerId: input.customerId,
        productId: input.productId,
        text: input.text,
        rating: input.rating,
        imageKey: input.imageKey,
        videoKey: input.videoKey,
        audioKey: input.audioKey,
      },
    });
    // بخش ۱۴.۲ — پیش‌فیلتر AI فعلی فقط متنی است و نمی‌تواند محتوای رسانه را بررسی کند؛ نظرات
    // رسانه‌دار همیشه مستقیم PENDING برای ادمین می‌مانند، بدون صف‌شدن در این پیش‌فیلتر
    if (!input.imageKey && !input.videoKey && !input.audioKey) {
      await this.moderationQueue.add('moderate', { commentId: comment.id });
    }
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

  // بخش ۱۴.۲ — برخلاف getApprovedForProduct بالا (فقط مصرف داخلی AI)، این برای endpoint عمومی
  // «مشاهده نظرات خریداران قبلی» در چت خریدار است؛ رسانه هم برمی‌گردد
  async getApprovedForProductWithMedia(
    productId: string,
    storeId: string,
    limit = 20,
  ) {
    return this.prisma.productComment.findMany({
      where: { productId, storeId, status: 'ADMIN_APPROVED' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        text: true,
        rating: true,
        imageKey: true,
        videoKey: true,
        audioKey: true,
        createdAt: true,
      },
    });
  }

  // مالکیت/تاییدشدگی کلید رسانه برای endpoint سرو عمومی (sales-agent.controller.ts) — فقط
  // رسانه‌ی نظرات ADMIN_APPROVED قابل‌مشاهده است، نه نظرات در صف بررسی
  async assertReviewMediaKey(
    commentId: string,
    key: string,
  ): Promise<'image' | 'video' | 'audio'> {
    return this.resolveMediaKind(commentId, key, true);
  }

  // عیناً بالا ولی بدون شرط ADMIN_APPROVED — ادمین باید بتواند رسانه‌ی نظرات PENDING را هم
  // ببیند تا اصلاً بتواند تصمیم تاییدش را بگیرد (comments-admin.controller.ts)
  async assertReviewMediaKeyForAdmin(
    commentId: string,
    key: string,
  ): Promise<'image' | 'video' | 'audio'> {
    return this.resolveMediaKind(commentId, key, false);
  }

  private async resolveMediaKind(
    commentId: string,
    key: string,
    requireApproved: boolean,
  ): Promise<'image' | 'video' | 'audio'> {
    const comment = await this.prisma.productComment.findUnique({
      where: { id: commentId },
    });
    if (!comment || (requireApproved && comment.status !== 'ADMIN_APPROVED')) {
      throw new NotFoundException(fa.store.reviewMediaNotFound);
    }
    if (comment.imageKey === key) return 'image';
    if (comment.videoKey === key) return 'video';
    if (comment.audioKey === key) return 'audio';
    throw new NotFoundException(fa.store.reviewMediaNotFound);
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
