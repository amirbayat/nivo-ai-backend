import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import type { ParsedChatFile } from '../validators/chat-file.validator';

export interface ExtractedChatFile {
  filename: string;
  text: string;
  truncated: boolean;
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
        text = result.text;
      } finally {
        await parser.destroy();
      }
    } else if (file.kind === 'docx') {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      text = result.value;
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
