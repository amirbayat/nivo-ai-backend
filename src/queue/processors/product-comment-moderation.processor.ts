import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { generateObject } from 'ai';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AiProviderService } from '../../common/services/ai-provider.service';
import type { ProductCommentModerationJobData } from '../../modules/comments/comments.service';

// همان مدل ارزان استفاده‌شده در store-kb.service.ts's generateBasicSuggestions — این هم یک
// پیش‌فیلتر سبک است، نه تصمیم نهایی
const MODERATION_MODEL = 'openai/gpt-5.4-mini';

// docs/PRD-customer-comments-and-discounts.md بخش الف/۴ — پیش‌فیلتر AI، نه جایگزین ادمین.
// فقط اسپم/نامرتبطِ خیلی مطمئن مستقیم AI_AUTO_REJECTED می‌شود؛ هر چیز دیگر (از جمله «مطمئن
// نیستم») PENDING می‌ماند تا ادمین با یک نگاه سریع تصمیم بگیرد — تصمیم نهایی همیشه با ادمین است.
const AUTO_REJECT_CONFIDENCE_THRESHOLD = 0.9;

@Processor('product-comment-moderation')
export class ProductCommentModerationProcessor {
  private readonly logger = new Logger(ProductCommentModerationProcessor.name);
  private readonly provider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiProvider: AiProviderService,
  ) {
    this.provider = this.aiProvider.buildClient();
  }

  @Process('moderate')
  async handle(job: Job<ProductCommentModerationJobData>): Promise<void> {
    const comment = await this.prisma.productComment.findUnique({
      where: { id: job.data.commentId },
    });
    if (!comment) return;

    try {
      const { object } = await generateObject({
        model: this.provider(MODERATION_MODEL),
        schema: z.object({
          isSpamOrAbusive: z.boolean(),
          isOnTopic: z.boolean(),
          confidence: z.number(),
        }),
        system: `تو یک پیش‌فیلتر نظرات خریداران یک فروشگاه آنلاین ایرانی هستی، نه تصمیم‌گیرنده‌ی
نهایی. متن زیر را بررسی کن: آیا اسپم/توهین‌آمیز/تبلیغاتی نامرتبط است (isSpamOrAbusive)؟ آیا
واقعاً درباره‌ی محصول/فروشگاه است (isOnTopic)؟ confidence بین ۰ تا ۱ میزان اطمینانت به تشخیص
isSpamOrAbusive را نشان بده. اگر مطمئن نیستی، confidence را پایین بگذار — تصمیم نهایی برای
موارد نامطمئن با یک ادمین انسانی است.`,
        prompt: comment.text,
      });

      const autoReject =
        object.isSpamOrAbusive &&
        object.confidence >= AUTO_REJECT_CONFIDENCE_THRESHOLD;

      await this.prisma.productComment.update({
        where: { id: comment.id },
        data: {
          status: autoReject ? 'AI_AUTO_REJECTED' : 'PENDING',
          aiVerdict: JSON.stringify(object),
          aiConfidence: object.confidence,
        },
      });
    } catch (err) {
      // شکست AI هرگز نباید نظر را قفل کند — همان PENDING بدون aiVerdict می‌ماند تا ادمین
      // دستی ببیندش (طبق اصل «AI فقط کمکی، ادمین همیشه پشتیبان»)
      this.logger.error(
        `moderation failed for comment=${comment.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
