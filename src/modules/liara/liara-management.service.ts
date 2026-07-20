import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

// docs/PRD-liara-usage-reconciliation.md — کلاینت نازک روی Management API لیارا
// (developers.liara.ir/ai-keys, /ai-logs) — با JWT مدیریتی حساب لیارای خودمان، نه چیزی که کاربر
// نهایی در اختیار داشته باشد. اگر envهای مدیریتی ست نشده باشند، هر متد throw می‌کند —
// caller (LiaraKeyProvisioningService / sync processor) مسئول fallback/skip است.

export interface LiaraLogEntry {
  content: {
    key?: string
    model?: string
    details?: {
      tokens_prompt?: number
      tokens_completion?: number
      total_cost_toman?: number
    }
  }
  url?: string
  createdAt?: string
}

@Injectable()
export class LiaraManagementService {
  private readonly logger = new Logger(LiaraManagementService.name)

  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string {
    return this.config.get<string>('LIARA_MANAGEMENT_BASE_URL') || 'https://ai.liara.ir'
  }

  // ست‌نبودن این دو یعنی فیچر رصد per-user فعال نیست — throw می‌شود تا caller بی‌صدا fallback کند
  private requireCredentials(): { jwt: string; workspaceName: string } {
    const jwt = this.config.get<string>('LIARA_MANAGEMENT_JWT')
    const workspaceName = this.config.get<string>('LIARA_WORKSPACE_NAME')
    if (!jwt || !workspaceName) {
      throw new Error('Liara management credentials (LIARA_MANAGEMENT_JWT/LIARA_WORKSPACE_NAME) not configured')
    }
    return { jwt, workspaceName }
  }

  async createApiKeyForUser(keyName: string): Promise<{ key: string; liaraKeyId: string }> {
    const { jwt, workspaceName } = this.requireCredentials()
    const res = await fetch(`${this.baseUrl()}/ai-keys/api-keys`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: keyName, workspaces: [workspaceName] }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Liara create-api-key failed (${res.status}): ${text.slice(0, 300)}`)
    }
    const json = (await res.json()) as { key?: string; _id?: string }
    if (!json.key || !json._id) throw new Error('Liara create-api-key returned no key/_id')
    return { key: json.key, liaraKeyId: json._id }
  }

  // صفحه‌بندی خودکار تا انتهای لیست — count بالا برای کم‌کردن تعداد رفت‌وبرگشت (هر کاربر روزی
  // چند ده لاگ دارد معمولاً، پس معمولاً همون صفحه‌ی اول کافی است)
  async fetchUsageLogs(keyName: string, from: Date, to: Date): Promise<LiaraLogEntry[]> {
    const { jwt } = this.requireCredentials()
    const logs: LiaraLogEntry[] = []
    let page = 1
    const count = 100
    for (;;) {
      const params = new URLSearchParams({
        key: keyName,
        from: from.toISOString(),
        to: to.toISOString(),
        page: String(page),
        count: String(count),
      })
      const res = await fetch(`${this.baseUrl()}/ai-logs/logs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${jwt}` },
        signal: AbortSignal.timeout(20_000),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Liara list-logs failed (${res.status}): ${text.slice(0, 300)}`)
      }
      const json = (await res.json()) as { logs?: LiaraLogEntry[] }
      const pageLogs = json.logs ?? []
      logs.push(...pageLogs)
      if (pageLogs.length < count) break
      page += 1
    }
    return logs
  }
}
