import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { encryptSecret, decryptSecret } from '../../common/utils/secret-cipher'
import { LiaraManagementService } from './liara-management.service'
import { normalizePhone } from '../../common/utils/normalize-phone'

export interface LiaraKeyProvisioningIssueRow {
  userId: string
  phone: string | null
  name: string | null
  lastError: string
  attemptCount: number
  firstFailedAt: Date
  lastAttemptAt: Date
}

// docs/PRD-liara-usage-reconciliation.md — یک کلید API اختصاصی لیارا به‌ازای هر کاربر، lazy
// (فقط در اولین تماس واقعی آن کاربر ساخته می‌شود، نه در signup). کلید بعد از ساخت decrypt و
// برگردانده می‌شود؛ caller (chat.service) مسئول fallback به کلید مشترک روی خطاست.
// هر شکست (JWT مدیریتی نامعتبر، لیارا در دسترس نیست، ...) در LiaraKeyProvisioningIssue ثبت
// می‌شود — هم برای نمایش در پنل ادمین، هم به‌عنوان صف جاب retry دوره‌ای؛ با اولین موفقیت بعدی
// (چه از مسیر lazy، چه از جاب retry) پاک می‌شود.
@Injectable()
export class LiaraKeyProvisioningService {
  private readonly logger = new Logger(LiaraKeyProvisioningService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly management: LiaraManagementService,
  ) {}

  // لیارا نام کلید را به ۳-۱۵ کاراکتر و الگوی ^[A-Za-z0-9._~|-]+$ محدود کرده — شماره‌ی
  // موبایل نرمال‌شده (۰۹xxxxxxxxx، فقط رقم) هم در این محدوده جا می‌شود و هم چون phone
  // یکتاست، تضمین می‌کند اسم کلید هم یکتا بماند
  private keyNameFor(phone: string): string {
    return normalizePhone(phone).slice(0, 15)
  }

  private encryptionSecret(): string {
    const secret = this.config.get<string>('LIARA_KEY_ENCRYPTION_SECRET')
    if (!secret) throw new Error('LIARA_KEY_ENCRYPTION_SECRET not configured')
    return secret
  }

  async getApiKeyForUser(userId: string): Promise<string> {
    try {
      const existing = await this.prisma.liaraApiKey.findUnique({ where: { userId } })
      if (existing) {
        const key = decryptSecret(existing.encryptedKey, this.encryptionSecret())
        await this.clearIssue(userId)
        return key
      }

      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } })
      const keyName = this.keyNameFor(user.phone)
      const { key, liaraKeyId } = await this.management.createApiKeyForUser(keyName)
      const encryptedKey = encryptSecret(key, this.encryptionSecret())

      try {
        await this.prisma.liaraApiKey.create({
          data: { userId, keyName, encryptedKey, liaraKeyId },
        })
      } catch (err) {
        // دو درخواست اول هم‌زمانِ همین کاربر می‌توانستند هر دو تا اینجا برسند — رکورد رقیب
        // برنده شده، پس همان را می‌خوانیم؛ کلید تازه‌ساخته‌شده‌ی این تلاش دور ریخته می‌شود
        // (بی‌ضرر، فقط یک کلید یتیم روی لیارا می‌ماند)
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const winner = await this.prisma.liaraApiKey.findUnique({ where: { userId } })
          if (winner) {
            const winnerKey = decryptSecret(winner.encryptedKey, this.encryptionSecret())
            await this.clearIssue(userId)
            return winnerKey
          }
        }
        throw err
      }

      await this.clearIssue(userId)
      return key
    } catch (err) {
      await this.recordIssue(userId, (err as Error).message)
      throw err
    }
  }

  private async recordIssue(userId: string, message: string): Promise<void> {
    try {
      await this.prisma.liaraKeyProvisioningIssue.upsert({
        where: { userId },
        create: { userId, lastError: message.slice(0, 500) },
        update: {
          lastError: message.slice(0, 500),
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
        },
      })
    } catch (err) {
      this.logger.warn(`Failed to record provisioning issue for user=${userId}: ${(err as Error).message}`)
    }
  }

  private async clearIssue(userId: string): Promise<void> {
    try {
      await this.prisma.liaraKeyProvisioningIssue.deleteMany({ where: { userId } })
    } catch (err) {
      this.logger.warn(`Failed to clear provisioning issue for user=${userId}: ${(err as Error).message}`)
    }
  }

  // برای پنل ادمین — «الان چند کاربر روی کلید مشترک fallback هستند و چرا»
  async listOpenIssues(): Promise<LiaraKeyProvisioningIssueRow[]> {
    const issues = await this.prisma.liaraKeyProvisioningIssue.findMany({
      orderBy: { lastAttemptAt: 'desc' },
      include: { user: { select: { phone: true, name: true } } },
    })
    return issues.map((i) => ({
      userId: i.userId,
      phone: i.user.phone,
      name: i.user.name,
      lastError: i.lastError,
      attemptCount: i.attemptCount,
      firstFailedAt: i.firstFailedAt,
      lastAttemptAt: i.lastAttemptAt,
    }))
  }

  // برای جاب retry دوره‌ای — لیست خام userId هایی که الان مشکل دارند (بدون join)
  async listIssueUserIds(): Promise<string[]> {
    const issues = await this.prisma.liaraKeyProvisioningIssue.findMany({ select: { userId: true } })
    return issues.map((i) => i.userId)
  }
}
