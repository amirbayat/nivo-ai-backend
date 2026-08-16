import { BadRequestException, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { Prisma, DiscountSource, type DiscountCode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { fa } from '../../i18n/fa';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بدون حروف/رقم شبیه‌به‌هم (O/0, I/1)

const SOURCE_PREFIX: Record<DiscountSource, string> = {
  WELCOME_GIFT: 'WELCOME',
  EXPIRY_REMINDER: 'RENEW',
  REFERRAL: 'REFER',
  MANUAL: 'NIVO',
};

/**
 * موتور مشترک کد تخفیف (docs/PRD-growth-traction-features.md بخش ۵) — هم کد شخصی
 * (صادرشده برای یک کاربر خاص، مثل هدیه‌ی خوش‌آمد/انقضا/معرفی) هم کد عمومی/کمپینی
 * (ساخته‌شده‌ی دستی توسط ادمین، issuedToUserId=null) از همین جا رد می‌شوند.
 */
@Injectable()
export class DiscountCodeService {
  constructor(private readonly prisma: PrismaService) {}

  private randomSuffix(length = 6): string {
    let out = '';
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++)
      out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return out;
  }

  /**
   * یک کد شخصی برای همین کاربر و همین source صادر می‌کند.
   *
   * `dedupe=true` (پیش‌فرض — مناسب WELCOME_GIFT): اگر از قبل یک کد فعال و منقضی‌نشده از همین
   * source برای همین کاربر وجود داشته باشد، همان را برمی‌گرداند (مثلاً چندبار باز کردن مدال هدیه،
   * چندتا کد نمی‌سازد — چون کاربر فقط یک‌بار زیر آستانه‌ی آزمایشی می‌رود).
   *
   * `dedupe=false` (لازم برای REFERRAL): هر بار صدا زده شود یک کد کاملاً تازه می‌سازد — چون یک
   * معرف می‌تواند چند دوست جدا معرفی کند و باید هر تبدیل موفق، پاداش جدا و جدید بگیرد؛ اگر اینجا
   * هم dedupe می‌کردیم، از معرفی دوم به بعد هیچ کد جدیدی صادر نمی‌شد.
   */
  async issuePersonalCode(params: {
    userId: string;
    source: DiscountSource;
    discountPercent: number;
    validHours?: number;
    validDays?: number;
    dedupe?: boolean;
  }): Promise<DiscountCode> {
    const {
      userId,
      source,
      discountPercent,
      validHours,
      validDays,
      dedupe = true,
    } = params;

    if (dedupe) {
      // Prisma نمی‌تونه مستقیم دو ستون (usedCount < maxUses) رو توی where مقایسه کنه،
      // پس فقط بر اساس isActive فیلتر می‌کنیم و شرط مصرف/انقضا رو دستی روی نتیجه چک می‌کنیم
      const existing = await this.prisma.discountCode.findFirst({
        where: { issuedToUserId: userId, source, isActive: true },
        orderBy: { createdAt: 'desc' },
      });
      if (
        existing &&
        existing.usedCount < existing.maxUses &&
        (!existing.expiresAt || existing.expiresAt > new Date())
      ) {
        return existing;
      }
    }

    const expiresAt = validHours
      ? new Date(Date.now() + validHours * 3_600_000)
      : validDays
        ? new Date(Date.now() + validDays * 86_400_000)
        : null;

    let code: string;
    // برخورد کد تصادفی عملاً بعید است ولی ارزون است که ایمن هم باشیم
    for (let attempt = 0; ; attempt++) {
      code = `${SOURCE_PREFIX[source]}-${this.randomSuffix()}`;
      const clash = await this.prisma.discountCode.findUnique({
        where: { code },
      });
      if (!clash) break;
      if (attempt > 5)
        throw new BadRequestException(fa.discount.generationFailed);
    }

    return this.prisma.discountCode.create({
      data: {
        code,
        discountPercent,
        source,
        issuedToUserId: userId,
        maxUses: 1,
        expiresAt,
      },
    });
  }

  /** کدهای تخفیف معتبر و مصرف‌نشده‌ی خودِ کاربر (هر source) — برای بخش «دعوت از دوستان» در پروفایل */
  async listValidCodesForUser(userId: string): Promise<DiscountCode[]> {
    const codes = await this.prisma.discountCode.findMany({
      where: { issuedToUserId: userId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    return codes.filter(
      (c) => c.usedCount < c.maxUses && (!c.expiresAt || c.expiresAt > now),
    );
  }

  /** برای initiate() پرداخت — کد را پیدا و اعتبارسنجی می‌کند، پرتاب خطا اگر نامعتبر بود */
  async findValidCode(code: string, userId: string): Promise<DiscountCode> {
    const found = await this.prisma.discountCode.findUnique({
      where: { code },
    });
    const valid =
      found &&
      found.isActive &&
      found.usedCount < found.maxUses &&
      (!found.expiresAt || found.expiresAt > new Date()) &&
      (found.issuedToUserId === null || found.issuedToUserId === userId);

    if (!found || !valid)
      throw new BadRequestException(fa.discount.invalidCode);
    return found;
  }

  /** برای verify() پرداخت — باید داخل همون $transaction موجود صدا زده شود تا اتمیک بماند */
  async recordRedemption(
    tx: Prisma.TransactionClient,
    discountCodeId: string,
    userId: string,
    paymentId: string,
  ): Promise<void> {
    await tx.discountCodeRedemption.create({
      data: { discountCodeId, userId, paymentId },
    });
    await tx.discountCode.update({
      where: { id: discountCodeId },
      data: { usedCount: { increment: 1 } },
    });
  }

  // ─── ادمین ──────────────────────────────────────────────────────────────

  listCodes(source?: DiscountSource) {
    return this.prisma.discountCode.findMany({
      where: source ? { source } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { issuedToUser: { select: { phone: true, name: true } } },
    });
  }

  createManualCode(data: {
    discountPercent: number;
    maxUses?: number;
    expiresAt?: string | null;
    codeSuffix?: string;
  }) {
    const code = `${SOURCE_PREFIX.MANUAL}-${(data.codeSuffix || this.randomSuffix()).toUpperCase()}`;
    return this.prisma.discountCode.create({
      data: {
        code,
        discountPercent: data.discountPercent,
        source: DiscountSource.MANUAL,
        maxUses: data.maxUses ?? 1,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      },
    });
  }

  async setActive(id: string, isActive: boolean) {
    return this.prisma.discountCode.update({
      where: { id },
      data: { isActive },
    });
  }
}
