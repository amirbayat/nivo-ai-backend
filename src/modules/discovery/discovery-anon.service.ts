import { HttpException, Injectable } from '@nestjs/common'
import type { AnonymousIdentity } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import type { AnonContext } from '../anon-chat/anon-identity.service'
import { DiscoveryGenerationService } from './discovery-generation.service'
import { GenerateAnonCreativeDto } from './dto/generate-anon-creative.dto'
import { fa } from '../../i18n/fa'

// gate یک‌بارمصرف (نه شمارنده) برای امتحان رایگان استودیو محتوا توسط مهمان — بر پایه‌ی
// AnonymousIdentity (IP)، دقیقاً هم‌فلسفه‌ی محدودیت پیام رایگان anon-chat. claim اتمیک با
// updateMany (نه findUnique+update) تا دو درخواست هم‌زمان نتوانند هر دو برنده شوند؛ اگر تولید
// واقعی fail شود، claim را برمی‌گردانیم تا خطای موقت AI فرصت رایگان کاربر را نسوزاند.
@Injectable()
export class DiscoveryAnonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discoveryService: DiscoveryGenerationService,
  ) {}

  async getStatus(identity: AnonymousIdentity): Promise<{ available: boolean; usedAt: string | null }> {
    return { available: identity.discoveryTrialUsedAt === null, usedAt: identity.discoveryTrialUsedAt?.toISOString() ?? null }
  }

  async generate(context: AnonContext, dto: GenerateAnonCreativeDto) {
    const { identity } = context
    const claim = await this.prisma.anonymousIdentity.updateMany({
      where: { id: identity.id, discoveryTrialUsedAt: null },
      data: { discoveryTrialUsedAt: new Date() },
    })
    if (claim.count === 0) {
      throw new HttpException({ message: fa.discovery.anonTrialAlreadyUsed, code: 'discovery_trial_used' }, 403)
    }

    try {
      return await this.discoveryService.generateAnonPreview(dto)
    } catch (err) {
      await this.prisma.anonymousIdentity.update({ where: { id: identity.id }, data: { discoveryTrialUsedAt: null } })
      throw err
    }
  }
}
