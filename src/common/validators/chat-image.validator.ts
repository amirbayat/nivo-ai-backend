import { BadRequestException } from '@nestjs/common';
import heicConvert from 'heic-convert';
import { fa } from '../../i18n/fa';

// docs/PRD-chat-images.md بخش ۵.۱ — تا الان StreamMessageDto.images فقط طول آرایه را
// محدود می‌کرد؛ هیچ چک فرمت/حجم/magic-bytes ای وجود نداشت (docs/SECURITY-AUDIT.md بخش ۸).
// SVG عمداً در لیست مجاز نیست — می‌تواند محتوای غیرمنتظره حمل کند؛ فرمت‌های raster این ریسک را ندارند.
const DATA_URL_RE =
  /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i;

function matchesMagicBytes(buffer: Buffer, ext: string): boolean {
  switch (ext) {
    case 'png':
      return buffer
        .subarray(0, 4)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    case 'jpg':
    case 'jpeg':
      return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    case 'gif':
      return buffer
        .subarray(0, 4)
        .equals(Buffer.from([0x47, 0x49, 0x46, 0x38]));
    case 'webp':
      // RIFF <4 بایت سایز> WEBP — بایت‌های ۰-۳ و ۸-۱۱ باید مطابقت داشته باشند
      return (
        buffer.subarray(0, 4).equals(Buffer.from([0x52, 0x49, 0x46, 0x46])) &&
        buffer.subarray(8, 12).equals(Buffer.from([0x57, 0x45, 0x42, 0x50]))
      );
    default:
      return false;
  }
}

export interface ParsedChatImage {
  ext: string;
  buffer: Buffer;
}

// عکس‌های آیفون (چه گرفته‌شده با دوربین، چه انتخاب‌شده از گالری با فرمت اصلی/HEIC) به‌جای
// image/jpeg با data:image/heic یا data:image/heif می‌رسند — DATA_URL_RE بالا اصلاً این
// mimeها را قبول نمی‌کند (نه توی چت، نه دیسکاوری، نه آپلود عکس نمونه‌ی ادمین) و کاربر با
// «فرمت غیرمجاز» رد می‌شود، حتی قبل از اینکه به gpt-image برسد. به‌جای اضافه‌کردن heic به
// فرمت‌های مجاز provider (که خودش HEIC نمی‌پذیرد)، همینجا قبل از اعتبارسنجی به JPEG تبدیلش می‌کنیم.
const HEIC_DATA_URL_RE =
  /^data:image\/hei[cf](?:-sequence)?;base64,([A-Za-z0-9+/]+={0,2})$/i;

// تشخیص HEIC از خودِ بایت‌ها (ftyp box استاندارد ISOBMFF) — مستقل از mime اعلام‌شده‌ی data
// URL، چون بعضی مرورگرها/سیستم‌عامل‌ها HEIC را با mime نادرست (مثل application/octet-stream)
// می‌فرستند
const HEIC_FTYP_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
]);

function isHeicBuffer(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer.toString('ascii', 4, 8) !== 'ftyp') return false;
  return HEIC_FTYP_BRANDS.has(buffer.toString('ascii', 8, 12).toLowerCase());
}

// اگر یک data URL واقعاً HEIC/HEIF باشد (چه با mime درست، چه فقط از روی بایت‌ها تشخیص‌داده‌شده)
// همین‌جا به JPEG تبدیلش می‌کنیم و یک data:image/jpeg;base64,... تازه برمی‌گردانیم؛ در غیر این
// صورت دقیقاً همان ورودی بدون تغییر برمی‌گردد — باید همیشه *قبل از* validateChatImages صدا زده شود
export async function normalizeHeicDataUrl(dataUrl: string): Promise<string> {
  const heicMatch = HEIC_DATA_URL_RE.exec(dataUrl);
  const genericMatch = /^data:[^;]+;base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    dataUrl,
  );
  const base64 = heicMatch?.[1] ?? genericMatch?.[1];
  if (!base64) return dataUrl;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    return dataUrl;
  }
  if (!heicMatch && !isHeicBuffer(buffer)) return dataUrl;

  try {
    const converted = await heicConvert({
      buffer,
      format: 'JPEG',
      quality: 0.92,
    });
    return `data:image/jpeg;base64,${Buffer.from(converted).toString('base64')}`;
  } catch {
    // اگر تبدیل شکست بخورد (مثلاً فایل خراب/جعلی)، ورودی اصلی را برمی‌گردانیم — validateChatImages
    // پایین‌دست همان‌طور که تا الان بود «فرمت غیرمجاز» می‌دهد، به‌جای اینکه اینجا کرش کند
    return dataUrl;
  }
}

// همون normalizeHeicDataUrl ولی برای آرایه‌ی عکس‌ها (dto.images چت) — ورودی‌های غیر-HEIC
// دست‌نخورده برمی‌گردند، فقط HEICها تبدیل می‌شوند
export async function normalizeHeicDataUrls(
  dataUrls: string[],
): Promise<string[]> {
  return Promise.all(dataUrls.map((d) => normalizeHeicDataUrl(d)));
}

const EXT_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

// همون فرمت‌های مجاز بالا (DATA_URL_RE) — برای ست کردن Content-Type درست وقتی عکس از
// MinIO سرو می‌شود (conversations.controller.ts، /:id/images/:filename)
export function mimeTypeForExt(ext: string): string {
  return EXT_MIME_TYPES[ext.toLowerCase()] ?? 'application/octet-stream';
}

// docs/PRD-chat-images.md بخش ۵.۴ — هم اعتبارسنجی هم آپلود MinIO از همین یک parse مشترک
// استفاده می‌کنند تا decode/regex دوبار (با ریسک واگرایی) تکرار نشود
export function parseChatImageDataUrl(dataUrl: string): ParsedChatImage | null {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return null;
  try {
    return {
      ext: match[1].toLowerCase(),
      buffer: Buffer.from(match[2], 'base64'),
    };
  } catch {
    return null;
  }
}

// 'jpg' و 'jpeg' یک فرمت‌اند — تنظیمات ادمین همیشه شکل canonical ('jpeg') را نگه می‌دارد
function normalizeExt(ext: string): string {
  return ext === 'jpg' ? 'jpeg' : ext;
}

export function validateChatImages(
  images: string[] | undefined,
  opts: { maxCount: number; maxSizeMb: number; allowedFormats: string[] },
): void {
  if (!images || images.length === 0) return;

  if (images.length > opts.maxCount) {
    throw new BadRequestException(fa.chatImages.tooMany(opts.maxCount));
  }

  const maxBytes = opts.maxSizeMb * 1024 * 1024;
  const allowed = opts.allowedFormats.map(normalizeExt);
  for (const image of images) {
    const parsed = parseChatImageDataUrl(image);
    if (!parsed) throw new BadRequestException(fa.chatImages.invalidFormat);

    const { ext, buffer } = parsed;
    if (!allowed.includes(normalizeExt(ext))) {
      throw new BadRequestException(
        fa.chatImages.formatNotAllowed(allowed.join('، ')),
      );
    }
    if (buffer.length === 0 || buffer.length > maxBytes) {
      throw new BadRequestException(fa.chatImages.tooLarge(opts.maxSizeMb));
    }
    if (!matchesMagicBytes(buffer, ext)) {
      throw new BadRequestException(fa.chatImages.contentMismatch);
    }
  }
}
