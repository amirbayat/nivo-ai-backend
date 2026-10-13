import * as XLSX from 'xlsx';
import { extractChatFileText } from './chat-file-extraction.util';

describe('2.6 — xlsx 0.20.x (بدون CVE) همچنان فایل اکسل را می‌خواند', () => {
  it('متن شیت را به CSV استخراج می‌کند', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['نام', 'قیمت'],
        ['کفش', 120000],
      ]),
      'محصولات',
    );
    const buffer = XLSX.write(wb, {
      type: 'buffer',
      bookType: 'xlsx',
    }) as Buffer;
    const out = await extractChatFileText(
      { ext: 'xlsx', kind: 'xlsx', buffer, filename: 'a.xlsx' },
      10_000,
    );
    expect(out.text).toContain('کفش,120000');
    expect(out.text).toContain('محصولات');
  });
});
