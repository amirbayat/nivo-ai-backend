import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// docs/PRD-buyer-orders-page-and-direct-order.md بخش ۲.۳ — ثبت نظر مستقیم از روی محصول/سفارش،
// مستقل از پیام پیگیریِ چت (awaitingReview) که از قبل وجود دارد
export class SubmitCommentDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  // docs/PRD-seller-demo-sandbox-hub-promo-and-release-prep.md بخش ۱۴.۲ — کلید MinIO، از
  // POST chat/:conversationId/comment-media آپلود و این‌جا پاس داده می‌شود
  @IsOptional()
  @IsString()
  @MaxLength(300)
  imageKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  videoKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  audioKey?: string;
}
