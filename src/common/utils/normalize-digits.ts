const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'

export function toEnglishDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (ch) => {
    const persianIndex = PERSIAN_DIGITS.indexOf(ch)
    if (persianIndex !== -1) return String(persianIndex)
    const arabicIndex = ARABIC_DIGITS.indexOf(ch)
    return arabicIndex !== -1 ? String(arabicIndex) : ch
  })
}
