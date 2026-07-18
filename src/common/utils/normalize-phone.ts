export function normalizePhone(phone: string): string {
  return phone.replace(/^\+98/, '0').replace(/^98/, '0')
}
