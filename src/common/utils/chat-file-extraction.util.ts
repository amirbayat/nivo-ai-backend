import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import type { ParsedChatFile } from '../validators/chat-file.validator';

export interface ExtractedChatFile {
  filename: string;
  text: string;
  truncated: boolean;
}

// فیدبک کاربر ۱۴۰۵/۰۷/۱۲ — متن خام pdf-parse/mammoth پر از کاراکترهای کنترلی/فاصله‌های
// تکراری/خط‌های خالی زیاد است (آرتیفکت استخراج، نه محتوای واقعی فایل)؛ قبل از رسیدن به AI
// یک‌بار تمیز می‌شود تا هم توکن کمتر مصرف شود هم مدل گیج نشود. فقط نرمال‌سازی whitespace —
// هیچ محتوایی که ممکن است واقعی باشد (مثل خطی که فقط یک عدد/قیمت است) حذف نمی‌شود.
function cleanExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

// docs/PRD-chat-files-and-pdf.md بخش ۳.۱ — استخراج متن سمت سرور (نه ارسال فایل خام به مدل)؛
// خروجی هر فایل به maxExtractedChars (ChatConfig، ادمین‌قابل‌تنظیم) truncate می‌شود تا یک فایل
// خیلی بزرگ بودجه‌ی توکن ورودی پیام را یک‌جا نخورد
export async function extractChatFileText(
  file: ParsedChatFile,
  maxExtractedChars: number,
): Promise<ExtractedChatFile> {
  let text = '';
  try {
    if (file.kind === 'pdf') {
      const parser = new PDFParse({ data: file.buffer });
      try {
        const result = await parser.getText();
        text = cleanExtractedText(result.text);
      } finally {
        await parser.destroy();
      }
    } else if (file.kind === 'docx') {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      text = cleanExtractedText(result.value);
    } else if (file.kind === 'xlsx') {
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      text = workbook.SheetNames.map((name) => {
        const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
        return `--- شیت «${name}» ---\n${csv}`;
      }).join('\n\n');
    } else {
      text = file.buffer.toString('utf-8');
    }
  } catch {
    // فایل خراب/رمزگذاری‌شده/فرمت غیرمنتظره — متن خالی برمی‌گردد، caller پیام «متنی نبود» می‌دهد
    text = '';
  }

  text = text.trim();
  const truncated = text.length > maxExtractedChars;
  return {
    filename: file.filename,
    text: truncated ? text.slice(0, maxExtractedChars) : text,
    truncated,
  };
}

// قالب تزریق به پیام کاربر — دقیقاً طبق PRD بخش ۳.۱
export function formatExtractedFileBlock(extracted: ExtractedChatFile): string {
  const suffix = extracted.truncated
    ? '\n[... فایل بریده شد، فقط بخش اول] '
    : '';
  return `--- فایل: ${extracted.filename} ---\n${extracted.text}${suffix}\n--- پایان فایل ---`;
}
