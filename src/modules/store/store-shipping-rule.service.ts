import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from './store.service';
import { CreateShippingRuleDto } from './dto/create-shipping-rule.dto';
import { UpdateShippingRuleDto } from './dto/update-shipping-rule.dto';
import { fa } from '../../i18n/fa';

// docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۲ — مدیریت هزینه/پوشش ارسال به
// تفکیک شهر در پنل فروشنده (همان الگوی StoreDiscountCodeService)
@Injectable()
export class StoreShippingRuleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
  ) {}

  async list(sellerId: string, storeId: string) {
    await this.storeService.getOwned(sellerId, storeId);
    return this.prisma.storeShippingRule.findMany({
      where: { storeId },
      // ردیف پیش‌فرض «سایر شهرها» (city=null) همیشه اول نمایش داده شود
      orderBy: [{ city: 'asc' }],
    });
  }

  async create(sellerId: string, storeId: string, dto: CreateShippingRuleDto) {
    await this.storeService.getOwned(sellerId, storeId);
    const city = dto.city ?? null;
    // @@unique([storeId, city]) با city قابل‌null بودن در پستگرس تضمین نمی‌شود (چند NULL
    // مجاز است)، پس چک تکراری‌بودن اینجا دستی انجام می‌شود — عیناً دلیل چک دستی مشابه در
    // StoreDiscountCodeService.create
    const existing = await this.prisma.storeShippingRule.findFirst({
      where: { storeId, city },
    });
    if (existing) throw new ConflictException(fa.store.shippingCityDuplicate);
    return this.prisma.storeShippingRule.create({
      data: {
        storeId,
        city,
        cost: dto.cost,
        enabled: dto.enabled ?? true,
      },
    });
  }

  async update(
    sellerId: string,
    storeId: string,
    ruleId: string,
    dto: UpdateShippingRuleDto,
  ) {
    await this.storeService.getOwned(sellerId, storeId);
    const rule = await this.prisma.storeShippingRule.findUnique({
      where: { id: ruleId },
    });
    if (!rule || rule.storeId !== storeId) {
      throw new NotFoundException(fa.store.shippingRuleNotFound);
    }
    return this.prisma.storeShippingRule.update({
      where: { id: ruleId },
      data: dto,
    });
  }

  async delete(sellerId: string, storeId: string, ruleId: string) {
    await this.storeService.getOwned(sellerId, storeId);
    const rule = await this.prisma.storeShippingRule.findUnique({
      where: { id: ruleId },
    });
    if (!rule || rule.storeId !== storeId) {
      throw new NotFoundException(fa.store.shippingRuleNotFound);
    }
    await this.prisma.storeShippingRule.delete({ where: { id: ruleId } });
    return { success: true };
  }
}
