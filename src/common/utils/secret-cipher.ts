import * as crypto from 'crypto'

// docs/PRD-liara-usage-reconciliation.md — تنها جایی در پروژه که یک secret خام (نه هش، مثل
// RefreshToken.tokenHash) باید در دیتابیس نگه داشته شود، چون بک‌اند بعداً خودِ مقدار خام را برای
// زدن درخواست به لیارا لازم دارد. AES-256-GCM: iv و authTag همراه ciphertext در یک رشته base64
// ذخیره می‌شوند تا فیلد دیتابیس تک‌ستونی بماند.
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest()
}

export function encryptSecret(plain: string, encryptionSecret: string): string {
  const key = deriveKey(encryptionSecret)
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64')
}

export function decryptSecret(payload: string, encryptionSecret: string): string {
  const key = deriveKey(encryptionSecret)
  const raw = Buffer.from(payload, 'base64')
  const iv = raw.subarray(0, IV_LENGTH)
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16)
  const ciphertext = raw.subarray(IV_LENGTH + 16)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
