import { extractLeadPhone, normalizeLeadPhone } from './lead-phone';

describe('normalizeLeadPhone', () => {
  it('normalizes Persian/Arabic digits and prefixes', () => {
    expect(normalizeLeadPhone('۰۹۱۲۳۴۵۶۷۸۹')).toBe('09123456789');
    expect(normalizeLeadPhone('٠٩١٢٣٤٥٦٧٨٩')).toBe('09123456789');
    expect(normalizeLeadPhone('+989123456789')).toBe('09123456789');
    expect(normalizeLeadPhone('00989123456789')).toBe('09123456789');
    expect(normalizeLeadPhone('9123456789')).toBe('09123456789');
    expect(normalizeLeadPhone('0912 345 6789')).toBe('09123456789');
  });
  it('rejects invalid numbers', () => {
    expect(normalizeLeadPhone('12345')).toBeNull();
    expect(normalizeLeadPhone('08123456789')).toBeNull();
    expect(normalizeLeadPhone(undefined)).toBeNull();
  });
  it('extracts a phone from free text', () => {
    expect(extractLeadPhone('شماره‌ام ۰۹۱۲۳۴۵۶۷۸۹ هست')).toBe('09123456789');
    expect(extractLeadPhone('سلام')).toBeNull();
  });
});
