import { toEnglishDigits } from './normalize-digits';

// Step 5 (3.11). Card and SHEBA checks. The full number is encrypted before storage.
// BIN / SHEBA bank-code tables are a short common set, not an official registry.

const CARD_BINS: Readonly<Record<string, string>> = {
  '603799': 'بانک ملی',
  '589210': 'بانک سپه',
  '627961': 'بانک صنعت و معدن',
  '603770': 'بانک کشاورزی',
  '628023': 'بانک مسکن',
  '627353': 'بانک تجارت',
  '627648': 'بانک توسعه صادرات',
  '207177': 'بانک توسعه صادرات',
  '627412': 'بانک اقتصاد نوین',
  '622106': 'بانک پارسیان',
  '502229': 'بانک پاسارگاد',
  '627488': 'بانک کارآفرین',
  '621986': 'بانک سامان',
  '639346': 'بانک سینا',
  '639607': 'بانک سرمایه',
  '502806': 'بانک شهر',
  '504706': 'بانک شهر',
  '603769': 'بانک صادرات',
  '610433': 'بانک ملت',
  '991975': 'بانک ملت',
  '585983': 'بانک تجارت',
  '627381': 'بانک انصار',
};

const SHEBA_BANKS: Readonly<Record<string, string>> = {
  '017': 'بانک ملی',
  '015': 'بانک سپه',
  '011': 'بانک صنعت و معدن',
  '016': 'بانک کشاورزی',
  '014': 'بانک مسکن',
  '018': 'بانک تجارت',
  '020': 'بانک توسعه صادرات',
  '055': 'بانک اقتصاد نوین',
  '054': 'بانک پارسیان',
  '057': 'بانک پاسارگاد',
  '053': 'بانک کارآفرین',
  '056': 'بانک سامان',
  '059': 'بانک سینا',
  '058': 'بانک سرمایه',
  '061': 'بانک شهر',
  '019': 'بانک صادرات',
  '012': 'بانک ملت',
  '013': 'بانک رفاه',
};

export function digitsOnly(raw: string): string {
  return toEnglishDigits(raw).replace(/\D/g, '');
}

export function luhnOk(digits: string): boolean {
  if (!/^\d{16}$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function ibanOk(raw: string): boolean {
  const compact = toEnglishDigits(raw).replace(/\s/g, '').toUpperCase();
  if (!/^IR\d{24}$/.test(compact)) return false;
  const moved = compact.slice(4) + compact.slice(0, 4);
  let n = '';
  for (const c of moved) {
    n += c >= 'A' && c <= 'Z' ? String(c.charCodeAt(0) - 55) : c;
  }
  let rem = 0;
  for (const ch of n) rem = (rem * 10 + (ch.charCodeAt(0) - 48)) % 97;
  return rem === 1;
}

export function bankNameForCard(digits: string): string | null {
  return CARD_BINS[digits.slice(0, 6)] ?? null;
}

export function bankNameForSheba(iban: string): string | null {
  const compact = toEnglishDigits(iban).replace(/\s/g, '').toUpperCase();
  return SHEBA_BANKS[compact.slice(4, 7)] ?? null;
}

export function maskCard(digits: string): string {
  const d = digitsOnly(digits);
  return `${d.slice(0, 4)}-${d.slice(4, 6)}**-****-${d.slice(12, 16)}`;
}

export function maskSheba(iban: string): string {
  const compact = toEnglishDigits(iban).replace(/\s/g, '').toUpperCase();
  return `${compact.slice(0, 4)}…${compact.slice(-4)}`;
}

export type ParsedDestination =
  | {
      type: 'CARD';
      plain: string;
      masked: string;
      bankName: string | null;
    }
  | {
      type: 'SHEBA';
      plain: string;
      masked: string;
      bankName: string | null;
    };

export function parseDestination(raw: string): ParsedDestination | null {
  const compact = toEnglishDigits(raw).replace(/[\s-]/g, '');
  if (/^IR/i.test(compact)) {
    const iban = compact.toUpperCase();
    if (!ibanOk(iban)) return null;
    return {
      type: 'SHEBA',
      plain: iban,
      masked: maskSheba(iban),
      bankName: bankNameForSheba(iban),
    };
  }
  const digits = digitsOnly(raw);
  if (!luhnOk(digits)) return null;
  return {
    type: 'CARD',
    plain: digits,
    masked: maskCard(digits),
    bankName: bankNameForCard(digits),
  };
}
