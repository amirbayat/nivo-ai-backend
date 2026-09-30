import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { OrderStatus } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as XLSX from 'xlsx';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { mimeTypeForExt } from '../../common/validators/chat-image.validator';
import { CreateStoreDto } from './dto/create-store.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { fa } from '../../i18n/fa';
import { computeConversationStats } from '../sales-agent/conversation-stats.util';
import { TelegramApiClientService } from '../telegram/telegram-api-client.service';

// docs/PRD-telegram-bot-channel.md بخش ۹.۱ — عمر لینک اتصال تلگرام فروشنده، یک‌بارمصرف
const TELEGRAM_CONNECT_TOKEN_TTL_MS = 15 * 60 * 1000;

// هدرهای پذیرفته‌شده‌ی آپلود اکسل محصول (گام ۳) — هم فارسی (چیزی که فروشنده واقعاً می‌نویسد)
// هم انگلیسی را می‌پذیرد
const PRODUCT_IMPORT_COLUMNS: Record<string, 'name' | 'basePrice' | 'stock'> = {
  نام: 'name',
  name: 'name',
  قیمت: 'basePrice',
  baseprice: 'basePrice',
  price: 'basePrice',
  موجودی: 'stock',
  stock: 'stock',
};

function cellToString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value).trim();
}

function cellToNumber(value: unknown): number | undefined {
  const s = cellToString(value);
  if (s === undefined) return undefined;
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
}

@Injectable()
export class StoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly telegramApi: TelegramApiClientService,
  ) {}

  list(sellerId: string) {
    return this.prisma.store.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      include: { products: true },
    });
  }

  async isSlugAvailable(slug: string): Promise<boolean> {
    const existing = await this.prisma.store.findUnique({ where: { slug } });
    return !existing;
  }

  async create(sellerId: string, dto: CreateStoreDto) {
    if (!(await this.isSlugAvailable(dto.slug))) {
      throw new ConflictException(fa.store.slugTaken);
    }
    return this.prisma.store.create({ data: { ...dto, sellerId } });
  }

  // مالکیت را چک می‌کند (۴۰۴/۴۰۳ مناسب پرتاب می‌کند) — الگوی ProjectsService.get
  async getOwned(sellerId: string, storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
    });
    if (!store) throw new NotFoundException(fa.store.notFound);
    if (store.sellerId !== sellerId)
      throw new ForbiddenException(fa.store.forbidden);
    return store;
  }

  async createProduct(
    sellerId: string,
    storeId: string,
    dto: CreateProductDto,
  ) {
    await this.getOwned(sellerId, storeId);
    if (dto.code) await this.assertProductCodeAvailable(storeId, dto.code);
    return this.prisma.product.create({ data: { ...dto, storeId } });
  }

  // docs/PRD-telegram-bot-channel.md بخش ۹.۳ — کد کوتاه یکتا فقط در سطح فروشگاه
  private async assertProductCodeAvailable(
    storeId: string,
    code: string,
    excludeProductId?: string,
  ): Promise<void> {
    // insensitive تا با جستجوی runtime در searchProducts هم‌خوان بماند — وگرنه «A12» و
    // «a12» هر دو قابل ثبت می‌شدند ولی موقع جستجو مبهم بودند
    const existing = await this.prisma.product.findFirst({
      where: {
        storeId,
        code: { equals: code, mode: 'insensitive' },
        ...(excludeProductId ? { id: { not: excludeProductId } } : {}),
      },
    });
    if (existing) throw new ConflictException(fa.store.productCodeTaken);
  }

  // docs/PRD-sales-agent-admin-analytics.md بخش ۴ — نسخه‌ی کوچک همین آمار برای خودِ فروشنده
  // (بدون فیلتر مدل، فقط مقایسه‌ی وب در برابر تلگرام برای همین فروشگاه)
  async getChannelStats(sellerId: string, storeId: string) {
    await this.getOwned(sellerId, storeId);
    return computeConversationStats(this.prisma, {
      storeId,
      groupBy: 'channel',
    });
  }

  async listProducts(sellerId: string, storeId: string) {
    await this.getOwned(sellerId, storeId);
    return this.prisma.product.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async getOwnedProduct(
    sellerId: string,
    storeId: string,
    productId: string,
  ) {
    await this.getOwned(sellerId, storeId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || product.storeId !== storeId)
      throw new NotFoundException(fa.store.productNotFound);
    return product;
  }

  async updateProduct(
    sellerId: string,
    storeId: string,
    productId: string,
    dto: UpdateProductDto,
  ) {
    await this.getOwnedProduct(sellerId, storeId, productId);
    if (dto.code)
      await this.assertProductCodeAvailable(storeId, dto.code, productId);
    return this.prisma.product.update({ where: { id: productId }, data: dto });
  }

  async deleteProduct(sellerId: string, storeId: string, productId: string) {
    await this.getOwnedProduct(sellerId, storeId, productId);
    await this.prisma.product.delete({ where: { id: productId } });
    return { success: true };
  }

  private static readonly MAX_PRODUCT_IMAGES = 4;

  // آپلود عکس محصول (فیدبک اول پایلوت) — الگوی اعتبارسنجی دقیقاً مثل submitReceipt در
  // sales-agent.service.ts (mimetype چک می‌شود، نه پسوند فایل)
  async addProductImages(
    sellerId: string,
    storeId: string,
    productId: string,
    files: Express.Multer.File[],
  ) {
    const product = await this.getOwnedProduct(sellerId, storeId, productId);
    if (
      product.images.length + files.length >
      StoreService.MAX_PRODUCT_IMAGES
    ) {
      throw new BadRequestException(fa.store.tooManyImages);
    }
    const keys: string[] = [];
    for (const file of files) {
      if (!file.mimetype.startsWith('image/')) {
        throw new BadRequestException(fa.store.imageOnly);
      }
      const ext = file.mimetype.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
      keys.push(await this.storage.uploadImage(file.buffer, ext));
    }
    return this.prisma.product.update({
      where: { id: productId },
      data: { images: { push: keys } },
    });
  }

  // docs/PRD-seller-knowledge-base.md بخش ۲.۵ — تصاویر پیشنهادی صفحه‌ی مبدأ، فقط بعد از
  // تأیید صریح فروشنده دانلود و به استوریج خودمان آپلود می‌شوند (نه مستقیم لینک خارجی ذخیره
  // شود، که با حذف/تغییر آن صفحه لینک‌های ما هم می‌شکند). یک URL ناموفق کل درخواست را
  // نمی‌ترکاند — فقط همان یکی رد می‌شود
  async addProductImagesFromUrl(
    sellerId: string,
    storeId: string,
    productId: string,
    urls: string[],
  ) {
    const product = await this.getOwnedProduct(sellerId, storeId, productId);
    const room = StoreService.MAX_PRODUCT_IMAGES - product.images.length;
    if (room <= 0) throw new BadRequestException(fa.store.tooManyImages);

    const keys: string[] = [];
    for (const url of urls.slice(0, room)) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(10_000),
        });
        const contentType = res.headers.get('content-type') ?? '';
        if (!res.ok || !contentType.startsWith('image/')) continue;
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length > 5 * 1024 * 1024) continue;
        const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
        keys.push(await this.storage.uploadImage(buffer, ext));
      } catch {
        // یک URL ناموفق کل درخواست را نمی‌ترکاند — فقط همان یکی رد می‌شود
      }
    }
    if (keys.length === 0) return product;
    return this.prisma.product.update({
      where: { id: productId },
      data: { images: { push: keys } },
    });
  }

  async removeProductImage(
    sellerId: string,
    storeId: string,
    productId: string,
    key: string,
  ) {
    const product = await this.getOwnedProduct(sellerId, storeId, productId);
    const remaining = product.images.filter((k) => k !== key);
    await this.storage.deleteObject(key).catch(() => undefined);
    return this.prisma.product.update({
      where: { id: productId },
      data: { images: remaining },
    });
  }

  // بدون چک مالکیت (سلر) — محتوای عمومی ویترین است، باید در <img> مرورگر مشتری ناشناس
  // هم لود شود؛ بدون storeId (productId+key به‌تنهایی کافی است) — فقط چک می‌کند کلید واقعاً
  // داخل images همین محصول است تا کلید دلخواه سرو نشود
  async getProductImage(productId: string, key: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product || !product.images.includes(key)) {
      throw new NotFoundException(fa.store.productNotFound);
    }
    const ext = key.split('.').pop() ?? '';
    const buffer = await this.storage.downloadImage(key);
    return { buffer, mimeType: mimeTypeForExt(ext) };
  }

  // parse-and-commit (نه دو-مرحله‌ای پیش‌نمایش) — فقط محصول جدید می‌سازد، upsert نیست چون
  // کلید طبیعی (SKU) نداریم؛ الگوی برگرفته از admin.service.ts importModels
  async importProducts(sellerId: string, storeId: string, buffer: Buffer) {
    await this.getOwned(sellerId, storeId);

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch {
      throw new BadRequestException(fa.store.excelUnreadable);
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
    });
    if (rows.length === 0) throw new BadRequestException(fa.store.excelEmpty);

    const headerMap = new Map<string, 'name' | 'basePrice' | 'stock'>();
    for (const key of Object.keys(rows[0])) {
      const normalized =
        PRODUCT_IMPORT_COLUMNS[key.trim()] ??
        PRODUCT_IMPORT_COLUMNS[key.trim().toLowerCase()];
      if (normalized) headerMap.set(key, normalized);
    }
    const mappedTargets = new Set(headerMap.values());
    if (!mappedTargets.has('name') || !mappedTargets.has('basePrice')) {
      throw new BadRequestException(fa.store.excelUnknownColumns);
    }

    let created = 0;
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2; // ردیف ۱ هدر است
      const raw = rows[i];
      const data: Record<string, unknown> = {};
      for (const [key, target] of headerMap) {
        data[target] =
          target === 'name' ? cellToString(raw[key]) : cellToNumber(raw[key]);
      }

      const instance = plainToInstance(CreateProductDto, data);
      const violations = await validate(instance);
      if (violations.length > 0) {
        const message = violations
          .map((v) => Object.values(v.constraints ?? {}).join('، '))
          .join(' | ');
        errors.push({ row: rowNumber, message });
        continue;
      }

      try {
        await this.prisma.product.create({
          data: { ...instance, storeId },
        });
        created++;
      } catch {
        errors.push({ row: rowNumber, message: 'خطا در ذخیره‌سازی این ردیف' });
      }
    }

    return { created, errors };
  }

  // docs/PRD-mvp-launch-plan.md گام ۱ — حداقلی، بدون UI: فروشنده باید بتواند سفارش‌های
  // در انتظار تایید را ببیند/تایید/رد کند تا حلقه‌ی سفارش با curl قابل تست باشد؛ صف کامل
  // با نمایش تصویر رسید در پنل موبایل، گام ۳ است.
  async listOrders(sellerId: string, storeId: string, status?: OrderStatus) {
    await this.getOwned(sellerId, storeId);
    return this.prisma.order.findMany({
      where: { storeId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOwnedOrder(sellerId: string, storeId: string, orderId: string) {
    await this.getOwned(sellerId, storeId);
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order || order.storeId !== storeId)
      throw new NotFoundException(fa.salesAgent.orderNotFound);
    return order;
  }

  async approveOrder(sellerId: string, storeId: string, orderId: string) {
    const order = await this.getOwnedOrder(sellerId, storeId, orderId);
    // docs/PRD-conversation-history.md — تأیید سفارش یعنی مکالمه واقعاً تمام شده: هم
    // currentState (COMPLETED، تا امروز هیچ‌جا ست نمی‌شد) هم archivedAt پر می‌شود تا هم
    // TERMINAL_STATES فرانت درست کار کند هم مکالمه از «فعال» بودن خارج شود
    return this.prisma.$transaction(async (tx) => {
      // docs/PRD-seller-multi-bank-card-rotation.md بخش ۲ — فقط روی تایید واقعی (نه لحظه‌ی
      // نمایش) به سقف THRESHOLD همان کارت اضافه می‌شود؛ خریدار ممکن است اصلاً پرداخت نکند
      if (order.bankCardId) {
        await tx.storeBankCard.update({
          where: { id: order.bankCardId },
          data: { totalConfirmedToman: { increment: order.totalAmount } },
        });
      }
      await tx.salesConversation.update({
        where: { id: order.conversationId },
        data: { currentState: 'COMPLETED', archivedAt: new Date() },
      });
      return tx.order.update({
        where: { id: orderId },
        data: { status: 'APPROVED' },
      });
    });
  }

  async rejectOrder(
    sellerId: string,
    storeId: string,
    orderId: string,
    reason?: string,
  ) {
    const order = await this.getOwnedOrder(sellerId, storeId, orderId);
    const [, updated] = await this.prisma.$transaction([
      this.prisma.salesConversation.update({
        where: { id: order.conversationId },
        data: { currentState: 'REJECTED', archivedAt: new Date() },
      }),
      this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'REJECTED', rejectReason: reason },
      }),
    ]);
    return updated;
  }

  // الگوی conversations.service.ts getImage — کلید در storage هیچ‌وقت مستقیم به فرانت داده
  // نمی‌شود، همیشه از پشت JwtGuard+مالکیت سرو می‌شود
  async getReceiptImage(sellerId: string, storeId: string, orderId: string) {
    const order = await this.getOwnedOrder(sellerId, storeId, orderId);
    if (!order.receiptImageKey)
      throw new NotFoundException(fa.store.noReceiptImage);
    const ext = order.receiptImageKey.split('.').pop() ?? '';
    const buffer = await this.storage.downloadImage(order.receiptImageKey);
    return { buffer, mimeType: mimeTypeForExt(ext) };
  }

  async listNeededAttention(sellerId: string, storeId: string) {
    await this.getOwned(sellerId, storeId);
    const conversations = await this.prisma.salesConversation.findMany({
      where: { storeId, isMutedForHuman: true },
      orderBy: { updatedAt: 'desc' },
      include: { customer: true },
    });
    return conversations.map((c) => ({
      id: c.id,
      customerLabel: c.customer.phone ?? c.customer.fullName ?? 'مشتری ناشناس',
      currentState: c.currentState,
      updatedAt: c.updatedAt,
    }));
  }

  async getOwnedConversation(
    sellerId: string,
    storeId: string,
    conversationId: string,
  ) {
    await this.getOwned(sellerId, storeId);
    const conversation = await this.prisma.salesConversation.findUnique({
      where: { id: conversationId },
      include: { customer: true },
    });
    if (!conversation || conversation.storeId !== storeId)
      throw new NotFoundException(fa.salesAgent.conversationNotFound);
    return conversation;
  }

  async getConversation(
    sellerId: string,
    storeId: string,
    conversationId: string,
  ) {
    const conversation = await this.getOwnedConversation(
      sellerId,
      storeId,
      conversationId,
    );
    const events = await this.prisma.conversationEvent.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });
    return {
      id: conversation.id,
      isMutedForHuman: conversation.isMutedForHuman,
      currentState: conversation.currentState,
      customerLabel:
        conversation.customer.phone ??
        conversation.customer.fullName ??
        'مشتری ناشناس',
      events,
    };
  }

  async sendSellerMessage(
    sellerId: string,
    storeId: string,
    conversationId: string,
    text: string,
  ) {
    const conversation = await this.getOwnedConversation(
      sellerId,
      storeId,
      conversationId,
    );
    const event = await this.prisma.conversationEvent.create({
      data: { conversationId, type: 'SELLER_MESSAGE', payload: { text } },
    });
    // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — قبلاً فقط وب (polling) این پیام را می‌دید؛
    // اگر مشتری از کانال تلگرام است، مستقیم پوش می‌شود
    if (
      conversation.customer.channel === 'TELEGRAM' &&
      conversation.customer.telegramChatId
    ) {
      await this.telegramApi.sendText(
        conversation.customer.telegramChatId,
        text,
      );
    }
    return event;
  }

  // docs/PRD-telegram-bot-channel.md بخش ۹.۱ — لینک اتصال یک‌بارمصرف («بیشتر» ← «اتصال
  // تلگرام»)؛ توکن کوتاه رندوم روی خودِ Store ذخیره می‌شود (نه یک جدول جدا) و بعد از مصرف
  // پاک می‌شود — TelegramService.handleStart این را با پیلود seller_<token> تشخیص می‌دهد
  async createTelegramConnectToken(sellerId: string, storeId: string) {
    await this.getOwned(sellerId, storeId);
    const token = randomBytes(6).toString('base64url');
    await this.prisma.store.update({
      where: { id: storeId },
      data: {
        telegramConnectToken: token,
        telegramConnectTokenExpiresAt: new Date(
          Date.now() + TELEGRAM_CONNECT_TOKEN_TTL_MS,
        ),
      },
    });
    return { token };
  }

  // «برگردون به ربات» — دستی، هیچ‌جا خودکار ریست نمی‌شود؛ currentState هم به BROWSING
  // برمی‌گردد چون دیسپچ موتور مکالمه (doUpdateCart و مشابه) فقط BROWSING/CART_REVIEW را
  // قبول می‌کند و سبد داخل contextData همچنان دست‌نخورده می‌ماند
  async unmuteConversation(
    sellerId: string,
    storeId: string,
    conversationId: string,
  ) {
    await this.getOwnedConversation(sellerId, storeId, conversationId);
    return this.prisma.salesConversation.update({
      where: { id: conversationId },
      data: {
        isMutedForHuman: false,
        currentState: 'BROWSING',
        clarifyAttempts: 0,
      },
    });
  }
}
