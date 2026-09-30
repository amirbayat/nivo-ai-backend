import { Injectable } from '@nestjs/common';
import type { StoreBankCard } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface SelectedBankCard {
  id: string | null;
  cardNumber: string;
  ownerName: string;
}

function toSelected(card: StoreBankCard): SelectedBankCard {
  return {
    id: card.id,
    cardNumber: card.cardNumber,
    ownerName: card.ownerName,
  };
}

// docs/PRD-seller-multi-bank-card-rotation.md — فراخوانی دقیقاً در لحظه‌ی ساخت
// PAYMENT_INSTRUCTIONS (conversation-engine.service.ts)
@Injectable()
export class CardSelectorService {
  constructor(private readonly prisma: PrismaService) {}

  async selectCard(storeId: string): Promise<SelectedBankCard> {
    const store = await this.prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      select: {
        cardDisplayPolicy: true,
        lastCardIndex: true,
        bankCardNumber: true,
        bankOwnerName: true,
      },
    });

    const cards = await this.prisma.storeBankCard.findMany({
      where: { storeId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });

    // fallback دفاعی — عملاً نباید پیش بیاید چون migration اولیه هر فروشگاه را با حداقل
    // یک StoreBankCard پر می‌کند، ولی اگر فروشنده همه‌ی کارت‌هایش را غیرفعال کرد نباید کرش کند
    if (cards.length === 0) {
      return {
        id: null,
        cardNumber: store.bankCardNumber,
        ownerName: store.bankOwnerName,
      };
    }
    if (cards.length === 1) return toSelected(cards[0]);

    switch (store.cardDisplayPolicy) {
      case 'THRESHOLD':
        return this.selectThreshold(cards);
      case 'PERCENTAGE':
        return this.selectPercentage(cards);
      case 'EQUAL':
      default:
        return this.selectEqual(storeId, cards, store.lastCardIndex);
    }
  }

  private selectThreshold(cards: StoreBankCard[]): SelectedBankCard {
    const card = cards.find(
      (c) =>
        c.thresholdToman == null || c.totalConfirmedToman < c.thresholdToman,
    );
    return toSelected(card ?? cards[cards.length - 1]);
  }

  private selectPercentage(cards: StoreBankCard[]): SelectedBankCard {
    const weights = cards.map((c) => Math.max(c.percentWeight ?? 0, 0));
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total <= 0) {
      return toSelected(cards[Math.floor(Math.random() * cards.length)]);
    }
    let r = Math.random() * total;
    for (let i = 0; i < cards.length; i++) {
      r -= weights[i];
      if (r <= 0) return toSelected(cards[i]);
    }
    return toSelected(cards[cards.length - 1]);
  }

  private async selectEqual(
    storeId: string,
    cards: StoreBankCard[],
    lastCardIndex: number,
  ): Promise<SelectedBankCard> {
    const nextIndex = (lastCardIndex + 1) % cards.length;
    await this.prisma.store.update({
      where: { id: storeId },
      data: { lastCardIndex: nextIndex },
    });
    return toSelected(cards[nextIndex]);
  }
}
