import type { IncomingMessage } from 'http';
import { json, urlencoded } from 'express';
import type { INestApplication } from '@nestjs/common';

// 2.6 — سقف پیش‌فرض بدنه‌ی JSON یک مگابایت است؛ فقط مسیرهایی که واقعاً عکس base64 یا متن بلند
// می‌گیرند (docs/PRD-chat-images.md بخش ۵.۲: عکس‌های چت base64 هستند، ~۳۳٪ بزرگ‌تر از بایت واقعی،
// و باید زیر سقف ۲۰ مگابایتی nginx بمانند) سقف بزرگ دارند. آپلودهای multipart از این مسیر
// عبور نمی‌کنند (multer سقف خودش را دارد).
export const DEFAULT_BODY_SIZE_LIMIT = '1mb';
export const UPLOAD_BODY_SIZE_LIMIT = '20mb';
export const UPLOAD_BODY_ROUTE_PREFIXES = [
  'chat',
  'anon-chat',
  'nivo-cal',
  'v2/discovery',
  'content-agent',
  'sales',
  'admin',
].map((prefix) => `/api/v1/${prefix}`);

// docs/PRD-instagram-smart-dm-and-ir-intl-split.md بخش ۷.۲ — وبهوک اینستاگرام امضای
// X-Hub-Signature-256 را روی بایت خام بدنه چک می‌کند (نه JSON.parse شده دوباره)؛ verify
// همین بافر را روی req.rawBody می‌گذارد، برای همه‌ی request ها (هزینه‌اش ناچیز است).
const verify = (req: IncomingMessage, _res: unknown, buf: Buffer) => {
  (req as IncomingMessage & { rawBody?: Buffer }).rawBody = buf;
};

// ترتیب مهم است: parser مسیرهای آپلود قبل از parser پیش‌فرض، چون body-parser بدنه‌ی
// پارس‌شده را دوباره پارس نمی‌کند. NestFactory باید با `bodyParser: false` ساخته شده باشد.
export function configureBodyParsers(app: INestApplication): void {
  app.use(
    UPLOAD_BODY_ROUTE_PREFIXES,
    json({ limit: UPLOAD_BODY_SIZE_LIMIT, verify }),
    urlencoded({ limit: UPLOAD_BODY_SIZE_LIMIT, extended: true }),
  );
  app.use(json({ limit: DEFAULT_BODY_SIZE_LIMIT, verify }));
  app.use(urlencoded({ limit: DEFAULT_BODY_SIZE_LIMIT, extended: true }));
}
