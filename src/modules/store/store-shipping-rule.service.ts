import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from './store.service';
import { CreateShippingRuleDto } from './dto/create-shipping-rule.dto';
import { UpdateShippingRuleDto } from './dto/update-shipping-rule.dto';
import { ContentChangeLogService } from './content-change-log.service';
import { fa } from '../../i18n/fa';

function shippingRuleSnapshot(rule: {
  provinces: string[];
  cost: number;
  enabled: boolean;
}): string {
  return JSON.stringify({
    provinces: rule.provinces,
    cost: rule.cost,
    enabled: rule.enabled,
  });
}

// docs/PRD-sales-agent-checkout-pricing-and-roadmap.md بخش ۲ (فاز ۱.۵) — مدیریت هزینه/پوشش
// ارسال به تفکیک استان در پنل فروشنده (همان الگوی StoreDiscountCodeService)
@Injectable()
export class StoreShippingRuleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
    private readonly changeLog: ContentChangeLogService,
  ) {}

  async list(sellerId: string, storeId: string) {
    await this.storeService.getOwned(sellerId, storeId);
    return this.prisma.storeShippingRule.findMany({
      where: { storeId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // «آخرین انتخاب برنده است» — هر استانی که در provinces تازه هست، از هر ردیف دیگر همین
  // فروشگاه که از قبل داشتتش حذف می‌شود؛ بدون خطا/تایید اضافه از فروشنده (بخش ۲ سند)
  private async reassignProvinces(
    storeId: string,
    provinces: string[],
    excludeRuleId?: string,
  ) {
    if (provinces.length === 0) return;
    const overlapping = await this.prisma.storeShippingRule.findMany({
      where: {
        storeId,
        id: excludeRuleId ? { not: excludeRuleId } : undefined,
        provinces: { hasSome: provinces },
      },
    });
    for (const rule of overlapping) {
      await this.prisma.storeShippingRule.update({
        where: { id: rule.id },
        data: {
          provinces: rule.provinces.filter((p) => !provinces.includes(p)),
        },
      });
    }
  }

  async create(sellerId: string, storeId: string, dto: CreateShippingRuleDto) {
    await this.storeService.getOwned(sellerId, storeId);
    const provinces = dto.provinces ?? [];
    if (provinces.length === 0) {
      // فقط یک ردیف «کل ایران» (provinces=[]) به‌ازای هر فروشگاه مجاز است
      const existingDefault = await this.prisma.storeShippingRule.findFirst({
        where: { storeId, provinces: { equals: [] } },
      });
      if (existingDefault) {
        throw new ConflictException(fa.store.shippingDefaultRuleDuplicate);
      }
    } else {
      await this.reassignProvinces(storeId, provinces);
    }
    const rule = await this.prisma.storeShippingRule.create({
      data: {
        storeId,
        provinces,
        cost: dto.cost,
        enabled: dto.enabled ?? true,
      },
    });
    await this.changeLog.logFieldChange({
      storeId,
      sellerId,
      entityType: 'SHIPPING_RULE',
      entityId: rule.id,
      fieldName: 'shippingRule',
      oldValue: null,
      newValue: shippingRuleSnapshot(rule),
    });
    return rule;
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
    if (dto.provinces !== undefined) {
      if (dto.provinces.length === 0) {
        const existingDefault = await this.prisma.storeShippingRule.findFirst({
          where: { storeId, provinces: { equals: [] }, id: { not: ruleId } },
        });
        if (existingDefault) {
          throw new ConflictException(fa.store.shippingDefaultRuleDuplicate);
        }
      } else {
        await this.reassignProvinces(storeId, dto.provinces, ruleId);
      }
    }
    const updated = await this.prisma.storeShippingRule.update({
      where: { id: ruleId },
      data: dto,
    });
    await this.changeLog.logFieldChange({
      storeId,
      sellerId,
      entityType: 'SHIPPING_RULE',
      entityId: ruleId,
      fieldName: 'shippingRule',
      oldValue: shippingRuleSnapshot(rule),
      newValue: shippingRuleSnapshot(updated),
    });
    return updated;
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
    await this.changeLog.logFieldChange({
      storeId,
      sellerId,
      entityType: 'SHIPPING_RULE',
      entityId: ruleId,
      fieldName: 'shippingRule',
      oldValue: shippingRuleSnapshot(rule),
      newValue: null,
    });
    return { success: true };
  }
}
