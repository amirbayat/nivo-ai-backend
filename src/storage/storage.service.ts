import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import * as crypto from 'crypto';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('MINIO_BUCKET', 'chat-images');
    this.client = new Client({
      endPoint: this.config.get<string>('MINIO_ENDPOINT', 'localhost'),
      port: Number(this.config.get('MINIO_PORT', '9000')),
      useSSL: this.config.get<string>('MINIO_USE_SSL', 'false') === 'true',
      accessKey: this.config.get<string>('MINIO_ACCESS_KEY', 'minioadmin'),
      secretKey: this.config.get<string>('MINIO_SECRET_KEY', 'minioadmin'),
    });
  }

  // خطای اتصال به MinIO نباید کل بک‌اند را از بالا آمدن بیندازد — فقط لاگ می‌شود؛
  // اگر واقعاً در دسترس نباشد، اولین آپلود واقعی خودش خطای روشن‌تری می‌دهد
  async onModuleInit() {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        this.logger.log(`bucket "${this.bucket}" created`);
      }
    } catch (err) {
      this.logger.error(
        `MinIO bucket check/create failed: ${(err as Error).message}`,
      );
    }
  }

  // کلید تصادفی UUID — غیرقابل‌حدس، ولی چیزی که واقعاً جلوی دسترسی غیرمجاز را می‌گیرد این
  // است که این کلید هرگز مستقیم به فرانت داده نمی‌شود؛ همیشه پشت JwtGuard + چک مالکیت
  // (conversations.service.ts getImage/findOne) سرو می‌شود، نه با یک presigned URL عمومی.
  // conversationId به‌عنوان پیشوند (پوشه‌ی مجازی در S3) اضافه می‌شود تا عکس‌های یک مکالمه
  // کنار هم باشند — هم برای مرور دستی توی کنسول، هم برای حذف دسته‌ای بعداً (مثلاً وقتی مکالمه پاک می‌شود)
  async uploadImage(
    buffer: Buffer,
    ext: string,
    conversationId?: string,
  ): Promise<string> {
    const key = `${conversationId ? `${conversationId}/` : ''}${crypto.randomUUID()}.${ext}`;
    await this.client.putObject(this.bucket, key, buffer);
    return key;
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
  }

  // هم برای ویرایش/ترکیب چند‌مرحله‌ای عکس (images/edits، بایت خام برای provider) و هم برای
  // سرو کردن عکس به فرانت از پشت GET /conversations/:id/images/:filename استفاده می‌شود
  async downloadImage(key: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  // رشته‌های قدیمی هنوز base64 خام هستند (data:image/...)؛ کلیدهای MinIO این‌طور نیستند —
  // docs/PRD-chat-images.md بخش ۴، برای تشخیص کدام رکورد باید از پشت بک‌اند سرو شود
  isStorageKey(value: string): boolean {
    return !value.startsWith('data:');
  }

  async statObject(key: string) {
    return this.client.statObject(this.bucket, key);
  }

  // برخلاف downloadImage (کل بافر را در حافظه می‌گیرد، مناسب عکس‌های سبک)، اینجا استریم خام
  // MinIO برگردانده می‌شود — برای فایل حجیمی مثل ویدیوی آموزشی nivo-cal، هم حافظه‌ی سرور پر
  // نمی‌شود هم می‌شود مستقیم pipe کرد به Response برای پخش تدریجی/Range request
  async getObjectStream(key: string, range?: { start: number; end: number }) {
    return range
      ? this.client.getPartialObject(
          this.bucket,
          key,
          range.start,
          range.end - range.start + 1,
        )
      : this.client.getObject(this.bucket, key);
  }
}
