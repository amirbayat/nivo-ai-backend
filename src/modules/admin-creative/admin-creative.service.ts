import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { ChatConfigService } from '../chat-config/chat-config.service';
import {
  mimeTypeForExt,
  parseChatImageDataUrl,
  validateChatImages,
} from '../../common/validators/chat-image.validator';
import { fa } from '../../i18n/fa';
import { CreateCreativePromptDto } from './dto/create-creative-prompt.dto';
import { UpdateCreativePromptDto } from './dto/update-creative-prompt.dto';
import { UpdateCreditConfigDto } from './dto/update-credit-config.dto';
import { CreateCreditPackageDto } from './dto/create-credit-package.dto';
import { UpdateCreditPackageDto } from './dto/update-credit-package.dto';
import { ReviewPromptRequestDto } from './dto/review-prompt-request.dto';
import { CreateCreativeCategoryDto } from './dto/create-creative-category.dto';
import { UpdateCreativeCategoryDto } from './dto/update-creative-category.dto';
import {
  CreativePromptReviewStatus,
  CreativePromptSourceType,
  CreativeSegment,
} from '@prisma/client';

// پنل ادمین برای بخش دیسکاوری/نیوو — بخش ۵.۷ سند فنی. عمداً ماژول جدا از AdminModule موجود
// (نه اضافه‌شدن به admin.service.ts غول‌پیکر) تا ریسک تغییر روی کد پرکاربرد فعلی صفر باشد؛
// همان guard (JwtGuard+AdminGuard) و همان قرارداد /admin/* را حفظ می‌کند.
@Injectable()
export class AdminCreativeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly chatConfig: ChatConfigService,
  ) {}

  // ── سبک‌های آماده (CreativePrompt) ──────────────────────────────────────────
  // آپلود «عکس نمونه» یک سبک از پنل ادمین — همون محدودیت‌های فرمت/حجم/magic-bytes چت
  // (ChatConfig ادمین) رو رعایت می‌کند تا مسیر اعتبارسنجی دوباره نوشته نشود؛ URL برگشتی از
  // مسیر عمومی DiscoveryPublicController سرو می‌شود (نه presigned URL مستقیم MinIO) تا
  // endpoint MinIO داخلی هیچ‌وقت به فرانت لو نرود.
  async uploadExampleImage(dataUrl: string): Promise<{ url: string }> {
    const chatConfig = await this.chatConfig.getConfig();
    validateChatImages([dataUrl], {
      maxCount: 1,
      maxSizeMb: chatConfig.maxImageSizeMb,
      allowedFormats: chatConfig.allowedImageFormats as string[],
    });
    // validateChatImages بالا همین دیتا-یو‌آرال رو با parseChatImageDataUrl چک کرده، پس اینجا حتماً null نیست
    const parsed = parseChatImageDataUrl(dataUrl)!;
    const key = await this.storage.uploadImage(parsed.buffer, parsed.ext);
    const apiUrl = this.config.get<string>('API_URL', 'http://localhost:3000');
    return { url: `${apiUrl}/api/v1/v2/discovery/example-images/${key}` };
  }

  // فرانت تب «کاتالوگ» را با sourceType=CURATED و تب «پیشنهادهای کاربران» را با
  // sourceType=USER_EXTRACTED&reviewStatus=PENDING صدا می‌زند — بدون فیلتر، همان رفتار
  // قدیمی (کل جدول) حفظ می‌شود، اما این حالت دیگر جایی در فرانت استفاده نمی‌شود چون هر
  // دو تب صریحاً فیلتر می‌فرستند (پیشنهادهای PENDING نباید در تب کاتالوگ ظاهر شوند)
  getPrompts(
    sourceType?: CreativePromptSourceType,
    reviewStatus?: CreativePromptReviewStatus,
  ) {
    return this.prisma.creativePrompt.findMany({
      where: {
        ...(sourceType ? { sourceType } : {}),
        ...(reviewStatus ? { reviewStatus } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: { submittedBy: { select: { phone: true, name: true } } },
    });
  }

  async getPrompt(id: string) {
    const prompt = await this.prisma.creativePrompt.findUnique({
      where: { id },
    });
    if (!prompt) throw new NotFoundException(fa.discovery.promptNotFound);
    return prompt;
  }

  createPrompt(dto: CreateCreativePromptDto) {
    // segment قدیمی دیگر از ادمین گرفته نمی‌شود — فقط برای سازگاری عقب‌رو با GENERAL پر می‌شود؛
    // دسته‌بندی واقعی از این پس categoryId (درخت CreativeCategory) است
    return this.prisma.creativePrompt.create({
      data: { ...dto, segment: dto.segment ?? CreativeSegment.GENERAL },
    });
  }

  async updatePrompt(id: string, dto: UpdateCreativePromptDto) {
    await this.getPrompt(id);
    return this.prisma.creativePrompt.update({ where: { id }, data: dto });
  }

  async deletePrompt(id: string) {
    await this.getPrompt(id);
    await this.prisma.creativePrompt.delete({ where: { id } });
    return { message: 'سبک حذف شد' };
  }

  // ── بررسی پیشنهادهای «تبدیل عکس به پرامپت» (CreativePrompt.sourceType=USER_EXTRACTED) ──
  countPendingSubmissions() {
    return this.prisma.creativePrompt.count({
      where: {
        sourceType: CreativePromptSourceType.USER_EXTRACTED,
        reviewStatus: CreativePromptReviewStatus.PENDING,
      },
    });
  }

  // تایید = ادمین قبلش هر ویرایشی (عنوان/دسته/قالب/تعویض عکس نمونه) را با PATCH prompts/:id
  // معمولی انجام داده؛ این اکشن فقط انتشار نهایی است — پیش‌نیاز: دسته و عکس نمونه ست شده باشند
  async approvePrompt(id: string) {
    const prompt = await this.getPrompt(id);
    if (!prompt.categoryId || !prompt.exampleImageUrl) {
      throw new BadRequestException(
        'قبل از تایید، دسته‌بندی و عکس نمونه را برای این پیشنهاد مشخص کنید',
      );
    }
    return this.prisma.creativePrompt.update({
      where: { id },
      data: {
        isActive: true,
        reviewStatus: CreativePromptReviewStatus.APPROVED,
      },
    });
  }

  async rejectPrompt(id: string) {
    await this.getPrompt(id);
    return this.prisma.creativePrompt.update({
      where: { id },
      data: { reviewStatus: CreativePromptReviewStatus.REJECTED },
    });
  }

  // عکس اصلی کاربر برای یک پیشنهاد — برخلاف DiscoveryPublicController.getExampleImage این‌جا
  // isActive فیلتر نمی‌شود چون این مسیر پشت AdminGuard است، نه عمومی
  async getPromptSourceImage(id: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const prompt = await this.prisma.creativePrompt.findUnique({
      where: { id },
      select: { sourceImageKey: true },
    });
    if (!prompt?.sourceImageKey) throw new NotFoundException(fa.errors.notFound);
    const ext = prompt.sourceImageKey.split('.').pop() ?? 'png';
    const buffer = await this.storage.downloadImage(prompt.sourceImageKey);
    return { buffer, mimeType: mimeTypeForExt(ext) };
  }

  // ── تنظیمات نیوو (CreditConfig singleton) ───────────────────────────────────
  getCreditConfig() {
    return this.prisma.creditConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });
  }

  updateCreditConfig(dto: UpdateCreditConfigDto) {
    return this.prisma.creditConfig.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...dto },
      update: dto,
    });
  }

  // ── بسته‌های خرید (CreditPackage) ────────────────────────────────────────────
  getCreditPackages() {
    return this.prisma.creditPackage.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  createCreditPackage(dto: CreateCreditPackageDto) {
    return this.prisma.creditPackage.create({ data: dto });
  }

  async updateCreditPackage(id: string, dto: UpdateCreditPackageDto) {
    const pkg = await this.prisma.creditPackage.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException(fa.errors.notFound);
    return this.prisma.creditPackage.update({ where: { id }, data: dto });
  }

  async deleteCreditPackage(id: string) {
    const pkg = await this.prisma.creditPackage.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException(fa.errors.notFound);
    await this.prisma.creditPackage.delete({ where: { id } });
    return { message: 'بسته حذف شد' };
  }

  // ── درخت دسته‌بندی دیسکاوری (CreativeCategory) ──────────────────────────────
  getCategories() {
    return this.prisma.creativeCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  createCategory(dto: CreateCreativeCategoryDto) {
    return this.prisma.creativeCategory.create({ data: dto });
  }

  async updateCategory(id: string, dto: UpdateCreativeCategoryDto) {
    const category = await this.prisma.creativeCategory.findUnique({
      where: { id },
    });
    if (!category) throw new NotFoundException(fa.errors.notFound);
    return this.prisma.creativeCategory.update({ where: { id }, data: dto });
  }

  async deleteCategory(id: string) {
    const category = await this.prisma.creativeCategory.findUnique({
      where: { id },
    });
    if (!category) throw new NotFoundException(fa.errors.notFound);
    // پرامپت‌های زیر این دسته و زیردسته‌ها onDelete:SetNull هستند — حذف امن است، فقط categoryId خالی می‌شود
    await this.prisma.creativeCategory.delete({ where: { id } });
    return { message: 'دسته حذف شد' };
  }

  // ── صف بررسی درخواست‌های سبک/فیچر جدید (CreativePromptRequest) ──────────────
  getPromptRequests(reviewed?: string) {
    return this.prisma.creativePromptRequest.findMany({
      where: reviewed !== undefined ? { isReviewed: reviewed === 'true' } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { phone: true, name: true } },
        prompt: { select: { title: true } },
      },
    });
  }

  async reviewPromptRequest(id: string, dto: ReviewPromptRequestDto) {
    const req = await this.prisma.creativePromptRequest.findUnique({
      where: { id },
    });
    if (!req) throw new NotFoundException(fa.errors.notFound);
    return this.prisma.creativePromptRequest.update({
      where: { id },
      data: dto,
    });
  }
}
