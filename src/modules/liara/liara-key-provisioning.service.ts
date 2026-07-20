import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import * as crypto from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { encryptSecret, decryptSecret } from '../../common/utils/secret-cipher'
import { LiaraManagementService } from './liara-management.service'

// docs/PRD-liara-usage-reconciliation.md — یک کلید API اختصاصی لیارا به‌ازای هر کاربر، lazy
// (فقط در اولین تماس واقعی آن کاربر ساخته می‌شود، نه در signup). کلید بعد از ساخت decrypt و
// برگردانده می‌شود؛ caller (chat.service) مسئول fallback به کلید مشترک روی خطاست.
@Injectable()
export class LiaraKeyProvisioningService {
  private readonly logger = new Logger(LiaraKeyProvisioningService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly management: LiaraManagementService,
  ) {}

  // لیارا نام کلید را به ۳-۱۵ کاراکتر و الگوی ^[A-Za-z0-9._~|-]+$ محدود کرده — پس از هشِ
  // userId، نه خودِ userId (که uuid با خط‌تیره‌ی طولانی‌تر از حد مجاز است)
  private keyNameFor(userId: string): string {
    return 'u' + crypto.createHash('sha256').update(userId).digest('hex').slice(0, 14)
  }

  private encryptionSecret(): string {
    const secret = this.config.get<string>('LIARA_KEY_ENCRYPTION_SECRET')
    if (!secret) throw new Error('LIARA_KEY_ENCRYPTION_SECRET not configured')
    return secret
  }

  async getApiKeyForUser(userId: string): Promise<string> {
    const existing = await this.prisma.liaraApiKey.findUnique({ where: { userId } })
    if (existing) return decryptSecret(existing.encryptedKey, this.encryptionSecret())

    const keyName = this.keyNameFor(userId)
    const { key, liaraKeyId } = await this.management.createApiKeyForUser(keyName)
    const encryptedKey = encryptSecret(key, this.encryptionSecret())

    try {
      await this.prisma.liaraApiKey.create({
        data: { userId, keyName, encryptedKey, liaraKeyId },
      })
      return key
    } catch (err) {
      // دو درخواست اول هم‌زمانِ همین کاربر می‌توانستند هر دو تا اینجا برسند — رکورد رقیب
      // برنده شده، پس همان را می‌خوانیم؛ کلید تازه‌ساخته‌شده‌ی این تلاش دور ریخته می‌شود
      // (بی‌ضرر، فقط یک کلید یتیم روی لیارا می‌ماند)
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.liaraApiKey.findUnique({ where: { userId } })
        if (winner) return decryptSecret(winner.encryptedKey, this.encryptionSecret())
      }
      throw err
    }
  }
}
