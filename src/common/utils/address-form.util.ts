import { IRAN_PROVINCES } from '../constants/iran-provinces';
import { fa } from '../../i18n/fa';
import { toEnglishDigits } from './normalize-digits';

export type AddressFormInput = {
  recipientName?: string;
  recipientPhone?: string;
  province?: string;
  city?: string;
  addressText?: string;
  postalCode?: string;
  plaque?: string;
  unit?: string;
};

export type AddressFieldErrors = Partial<
  Record<'name' | 'phone' | 'province' | 'city' | 'street' | 'postal', string>
>;

export type AddressFormValues = {
  recipientName: string;
  recipientPhone: string;
  province: string;
  city: string;
  addressText: string;
  postalCode: string;
  plaque: string;
  unit: string;
};

export type AddressFormResult = {
  ok: boolean;
  errors: AddressFieldErrors;
  values: AddressFormValues;
  phone: string | null;
  postal: string | null;
};

function compactMobile(raw: string): string {
  return toEnglishDigits(raw).replace(/[\s-]/g, '');
}

export function normalizeIranMobile(raw: string): string | null {
  let digits = compactMobile(raw);
  if (digits.startsWith('+98')) digits = `0${digits.slice(3)}`;
  else if (digits.startsWith('0098')) digits = `0${digits.slice(4)}`;
  else if (/^98\d{10}$/.test(digits)) digits = `0${digits.slice(2)}`;
  else if (/^9\d{9}$/.test(digits)) digits = `0${digits}`;
  return /^09\d{9}$/.test(digits) ? digits : null;
}

export function normalizePostalCode(raw: string): { digits: string; ok: boolean } {
  const digits = toEnglishDigits(raw).replace(/[\s-]/g, '');
  return { digits, ok: /^\d{10}$/.test(digits) };
}

export function validateAddressForm(input: AddressFormInput): AddressFormResult {
  const name = input.recipientName?.trim() ?? '';
  const province = input.province ?? '';
  const city = input.city?.trim() ?? '';
  const street = input.addressText?.trim() ?? '';
  const phoneRaw = compactMobile(input.recipientPhone ?? '');
  const phone = normalizeIranMobile(input.recipientPhone ?? '');
  const postal = normalizePostalCode(input.postalCode ?? '');
  const plaque = (input.plaque ?? '').trim();
  const unit = input.unit?.trim() ?? '';
  const errors: AddressFieldErrors = {};
  if (!name) errors.name = fa.salesAgent.addressFieldName;
  if (!phone) errors.phone = fa.salesAgent.addressFieldPhone;
  if (!IRAN_PROVINCES.includes(province)) errors.province = fa.salesAgent.addressFieldProvince;
  if (!city) errors.city = fa.salesAgent.addressFieldCity;
  if (!street) errors.street = fa.salesAgent.addressFieldStreet;
  if (!postal.ok) errors.postal = fa.salesAgent.addressFieldPostal;
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    values: {
      recipientName: name,
      recipientPhone: phone ?? phoneRaw,
      province,
      city,
      addressText: street,
      postalCode: postal.digits,
      plaque,
      unit,
    },
    phone,
    postal: postal.ok ? postal.digits : null,
  };
}
