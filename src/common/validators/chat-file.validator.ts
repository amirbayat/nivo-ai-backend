import { BadRequestException } from '@nestjs/common';
import { fa } from '../../i18n/fa';

// docs/PRD-chat-files-and-pdf.md بخش ۳ — فقط ورودی این هفته: PDF/DOCX/TXT/MD/CSV/XLSX + چند
// پسوند کد رایج. دقیقاً الگوی chat-image.validator.ts (magic bytes، نه فقط پسوند فایل)، به‌علاوه‌ی
// چک ساده‌ی «متن UTF-8 معتبر» برای فرمت‌هایی که magic bytes ذاتی ندارند (txt/md/csv/کد)
const DATA_URL_RE = /^data:([^;]+);base64,([A-Za-z0-9+/]+={0,2})$/i;

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'csv',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'json',
  'html',
  'css',
  'java',
  'c',
  'cpp',
  'go',
  'rb',
  'php',
  'sh',
  'yaml',
  'yml',
  'xml',
  'sql',
]);

export type ChatFileKind = 'pdf' | 'docx' | 'xlsx' | 'text';

export interface ParsedChatFile {
  ext: string;
  kind: ChatFileKind;
  buffer: Buffer;
  filename: string;
}

const EXT_MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// فقط برای چیپ نمایش فایل در پیام کاربر (نه اعتبارسنجی) — فرمت‌های متنی یک mime عمومی می‌گیرند
export function mimeTypeForFileExt(ext: string): string {
  return EXT_MIME_TYPES[ext.toLowerCase()] ?? 'text/plain';
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

// DOCX و XLSX هر دو ZIP هستند (Office Open XML) — همین چک به‌تنهایی جلوی «هر فایل دلخواه با
// پسوند تغییریافته» را می‌گیرد؛ باز کردن کامل جدول مرکزی ZIP برای تشخیص دقیق‌تر word/ در برابر
// xl/ برای این راند لازم نیست (همان سطح اعتماد chat-image.validator.ts به magic bytes ساده)
function isZip(buffer: Buffer): boolean {
  return buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
}

// هیچ magic bytes ذاتی‌ای برای متن ساده وجود ندارد — فقط چک می‌کنیم واقعاً UTF-8 معتبر است
// (نه یک باینری دلخواه که کسی پسوندش را به .txt عوض کرده)؛ کاراکتر replacement (U+FFFD) یعنی
// دیکد شکست خورده
function isValidUtf8Text(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  const text = buffer.toString('utf-8');
  if (text.includes('�')) return false;
  // کاراکترهای کنترلی غیرمنتظره (به‌جز تب/newline/CR که در متن معمولی طبیعی‌اند) — نشانه‌ی یک
  // فایل باینری که پسوندش به .txt/.md/... تغییر کرده. eslint نگاشتن رنج کنترلی توی خود regex
  // literal را (no-control-regex) نمی‌پسندد، پس با charCodeAt چک می‌شود، نه رجکس
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13) continue; // tab/LF/CR مجازند
    if (code <= 8 || (code >= 14 && code <= 31)) return false;
  }
  return true;
}

export function parseChatFileDataUrl(
  dataUrl: string,
  filename: string,
): ParsedChatFile | null {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return null;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(match[2], 'base64');
  } catch {
    return null;
  }
  const ext = extOf(filename);
  if (!ext) return null;

  if (ext === 'pdf') return { ext, kind: 'pdf', buffer, filename };
  if (ext === 'docx') return { ext, kind: 'docx', buffer, filename };
  if (ext === 'xlsx') return { ext, kind: 'xlsx', buffer, filename };
  if (TEXT_EXTENSIONS.has(ext)) return { ext, kind: 'text', buffer, filename };
  return null;
}

export function validateChatFiles(
  files: { data: string; filename: string }[] | undefined,
  opts: { maxSizeMb: number },
): ParsedChatFile[] {
  if (!files || files.length === 0) return [];

  const maxBytes = opts.maxSizeMb * 1024 * 1024;
  return files.map(({ data, filename }) => {
    const parsed = parseChatFileDataUrl(data, filename);
    if (!parsed) throw new BadRequestException(fa.chatFiles.invalidFormat);

    if (parsed.buffer.length === 0 || parsed.buffer.length > maxBytes) {
      throw new BadRequestException(fa.chatFiles.tooLarge(opts.maxSizeMb));
    }

    if (parsed.kind === 'pdf' && !isPdf(parsed.buffer)) {
      throw new BadRequestException(fa.chatFiles.contentMismatch);
    }
    if (
      (parsed.kind === 'docx' || parsed.kind === 'xlsx') &&
      !isZip(parsed.buffer)
    ) {
      throw new BadRequestException(fa.chatFiles.contentMismatch);
    }
    if (parsed.kind === 'text' && !isValidUtf8Text(parsed.buffer)) {
      throw new BadRequestException(fa.chatFiles.contentMismatch);
    }

    return parsed;
  });
}
