/** برای جلوگیری از افتادن merchant id / api key کامل توی لاگ‌ها */
export function maskSecret(value: string | undefined): string {
  if (!value) return '(خالی)'
  if (value.length <= 6) return '***'
  return `${value.slice(0, 3)}***${value.slice(-3)}`
}
