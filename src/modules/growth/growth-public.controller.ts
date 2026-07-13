import { Controller, ForbiddenException, Get, Post, UseGuards } from '@nestjs/common'
import { DiscountSource } from '@prisma/client'
import { JwtGuard } from '../../common/guards/jwt.guard'
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator'
import { PrismaService } from '../../prisma/prisma.service'
import { TokenService } from '../usage/token.service'
import { OnboardingGiftService } from './onboarding-gift.service'
import { GrowthConfigService } from './growth-config.service'
import { DiscountCodeService } from './discount-code.service'
import { fa } from '../../i18n/fa'

@Controller('growth')
export class GrowthPublicController {
  constructor(
    private readonly onboardingGift: OnboardingGiftService,
    private readonly growthConfig: GrowthConfigService,
    private readonly discountCode: DiscountCodeService,
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('onboarding-gift')
  async getGift() {
    const gift = await this.onboardingGift.getGift()
    if (!gift.isActive) return { isActive: false as const }
    return gift
  }

  // docs/PRD-growth-traction-features.md بخش ۳.۵ — قبلاً واجدشرایط‌بودن فقط «هنوز داخل trial»
  // بود؛ یعنی کاربری که trial اش تموم می‌شد و دکمه‌ی claim رو نزده بود، برای همیشه از کد تخفیف
  // هدیه محروم می‌ماند (باگ). حالا یک فاز دوم («grace») اضافه شده: تا postTrialGraceHours ساعت
  // بعد از پایان trial هم، اگر هنوز خریدی نکرده باشد، همچنان می‌تواند claim/استفاده کند.
  private async getWelcomeGiftEligibility(userId: string): Promise<{
    eligible: boolean
    phase: 'trial' | 'grace' | null
    graceDeadline: Date | null
  }> {
    const [plan, dbUser, hasPaid] = await Promise.all([
      this.tokenService.getCachedPlan(userId),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { lifetimeMessageCount: true, trialEndedAt: true },
      }),
      this.prisma.payment.count({ where: { userId, status: 'COMPLETED' } }).then(c => c > 0),
    ])

    // بعد از اولین خرید، هدیه‌ی خوش‌آمد دیگر موضوعیت ندارد — حتی اگر هنوز داخل پنجره‌ی مهلت باشد
    if (hasPaid) return { eligible: false, phase: null, graceDeadline: null }

    if (plan.trialMessageThreshold !== null && dbUser.lifetimeMessageCount < plan.trialMessageThreshold) {
      return { eligible: true, phase: 'trial', graceDeadline: null }
    }

    if (dbUser.trialEndedAt) {
      const config = await this.growthConfig.getConfig()
      const graceDeadline = new Date(dbUser.trialEndedAt.getTime() + config.postTrialGraceHours * 3_600_000)
      if (Date.now() < graceDeadline.getTime()) {
        return { eligible: true, phase: 'grace', graceDeadline }
      }
    }

    return { eligible: false, phase: null, graceDeadline: null }
  }

  // برای بنر هدیه در صفحه‌ی چت — یک درخواست، هم واجدشرایط‌بودن هم محتوای هدیه را می‌دهد.
  // welcomeDiscountValidHours هم برگردانده می‌شود تا کارت هدیه، حتی قبل از claim، مهلت
  // کد تخفیف را نشان بدهد (نه فقط بعد از گرفتن کد)
  @Get('onboarding-gift/status')
  @UseGuards(JwtGuard)
  async getGiftStatus(@CurrentUser() user: JwtPayload) {
    const [gift, eligibility, config] = await Promise.all([
      this.onboardingGift.getGift(),
      this.getWelcomeGiftEligibility(user.sub),
      this.growthConfig.getConfig(),
    ])
    const show = eligibility.eligible && gift.isActive
    return {
      eligible: show,
      phase: show ? eligibility.phase : null,
      graceDeadline: show ? eligibility.graceDeadline : null,
      welcomeDiscountValidHours: config.welcomeDiscountValidHours,
      gift: show ? gift : null,
    }
  }

  // چک واجدشرایط‌بودن (docs/PRD-growth-traction-features.md بخش ۴.۳) سمت سرور دوباره
  // انجام می‌شود — به فرانت اعتماد نمی‌کنیم که فقط زیر آستانه بنر رو نشون داده
  @Post('onboarding-gift/claim')
  @UseGuards(JwtGuard)
  async claimGift(@CurrentUser() user: JwtPayload) {
    const { eligible } = await this.getWelcomeGiftEligibility(user.sub)
    if (!eligible) throw new ForbiddenException(fa.discount.notEligible)

    const config = await this.growthConfig.getConfig()
    const code = await this.discountCode.issuePersonalCode({
      userId: user.sub,
      source: DiscountSource.WELCOME_GIFT,
      discountPercent: config.welcomeDiscountPercent,
      validHours: config.welcomeDiscountValidHours,
    })

    return { code: code.code, discountPercent: code.discountPercent, expiresAt: code.expiresAt }
  }

  // برای بخش «دعوت از دوستان» در پروفایل — کدهای تخفیف معتبر خود کاربر (هدیه/معرفی/یادآوری
  // انقضا) را نشان می‌دهد؛ بدون این، کد تخفیفی که از معرفی دوستان صادر می‌شود جایی دیده نمی‌شد
  @Get('my-discount-codes')
  @UseGuards(JwtGuard)
  myDiscountCodes(@CurrentUser() user: JwtPayload) {
    return this.discountCode.listValidCodesForUser(user.sub)
  }
}
