import { toEnglishDigits } from './normalize-digits';

// Step 5 (3.11). Strip card numbers and SHEBA from text before it is sent to a model.
// The buyer is pointed at the refund form instead. Four-digit fragments are left alone.

const SHEBA = /IR[\s\u200c-]*[\d۰-۹٠-٩](?:[\s\u200c-]*[\d۰-۹٠-٩]){23}/gi;
const CARD = /(?<!\d)(?:[\d۰-۹٠-٩][\s\u200c-]*){16}(?!\d)/g;

function compactDigits(raw: string): string {
  return toEnglishDigits(raw).replace(/\D/g, '');
}

export function maskPaymentSecrets(text: string): string {
  const withoutSheba = text.replace(SHEBA, (m) => {
    const compact = toEnglishDigits(m).replace(/[\s\u200c-]/g, '').toUpperCase();
    if (!/^IR\d{24}$/.test(compact)) return m;
    return `${compact.slice(0, 4)}…${compact.slice(-4)}`;
  });
  return withoutSheba.replace(CARD, (m) => {
    const digits = compactDigits(m);
    if (digits.length !== 16) return m;
    return `${digits.slice(0, 4)}-****-****-${digits.slice(12)}`;
  });
}
