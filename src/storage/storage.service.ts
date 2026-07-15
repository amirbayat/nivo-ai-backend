import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Client } from 'minio'
import * as crypto from 'crypto'

// docs/PRD-chat-images.md بخش ۳.۲ — کافی برای این‌که کاربر تاریخچه‌ی مکالمه را باز کند و
// عکس‌ها بارگذاری شوند؛ کوتاه نگه داشته می‌شود چون presigned URL که یک‌بار صادر شد قابل ابطال نیست
const PRESIGN_EXPIRY_SECONDS = 10 * 60

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name)
  private readonly client: Client
  private readonly bucket: string

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('MINIO_BUCKET', 'chat-images')
    this.client = new Client({
      endPoint: this.config.get<string>('MINIO_ENDPOINT', 'localhost'),
      port: Number(this.config.get('MINIO_PORT', '9000')),
      useSSL: this.config.get<string>('MINIO_USE_SSL', 'false') === 'true',
      accessKey: this.config.get<string>('MINIO_ACCESS_KEY', 'minioadmin'),
      secretKey: this.config.get<string>('MINIO_SECRET_KEY', 'minioadmin'),
    })
  }

  // خطای اتصال به MinIO نباید کل بک‌اند را از بالا آمدن بیندازد — فقط لاگ می‌شود؛
  // اگر واقعاً در دسترس نباشد، اولین آپلود واقعی خودش خطای روشن‌تری می‌دهد
  async onModuleInit() {
    try {
      const exists = await this.client.bucketExists(this.bucket)
      if (!exists) {
        await this.client.makeBucket(this.bucket)
        this.logger.log(`bucket "${this.bucket}" created`)
      }
    } catch (err) {
      this.logger.error(`MinIO bucket check/create failed: ${(err as Error).message}`)
    }
  }

  // کلید تصادفی UUID — غیرقابل‌حدس، چون MinIO خصوصی نیست تضمین امنیتی محسوب نمی‌شود ولی
  // presigned URL (نه public bucket) واقعی جلوگیری از دسترسی غیرمجاز است (بخش ۳.۲ PRD).
  // conversationId به‌عنوان پیشوند (پوشه‌ی مجازی در S3) اضافه می‌شود تا عکس‌های یک مکالمه
  // کنار هم باشند — هم برای مرور دستی توی کنسول، هم برای حذف دسته‌ای بعداً (مثلاً وقتی مکالمه پاک می‌شود)
  async uploadImage(buffer: Buffer, ext: string, conversationId?: string): Promise<string> {
    const key = `${conversationId ? `${conversationId}/` : ''}${crypto.randomUUID()}.${ext}`
    await this.client.putObject(this.bucket, key, buffer)
    return key
  }

  async presignedGetUrl(key: string): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, PRESIGN_EXPIRY_SECONDS)
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key)
  }

  // برای ویرایش/ترکیب چند‌مرحله‌ای عکس (images/edits) — برخلاف presignedGetUrl که فقط یک
  // لینک می‌دهد، اینجا واقعاً بایت‌های تصویر لازم است تا مستقیم به provider فرستاده شود
  async downloadImage(key: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, key)
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks)
  }

  // رشته‌های قدیمی هنوز base64 خام هستند (data:image/...)؛ کلیدهای MinIO این‌طور نیستند —
  // docs/PRD-chat-images.md بخش ۴، برای تشخیص کدام رکورد presign لازم دارد
  isStorageKey(value: string): boolean {
    return !value.startsWith('data:')
  }
}
