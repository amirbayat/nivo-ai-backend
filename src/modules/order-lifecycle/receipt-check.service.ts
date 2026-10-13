import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { createHash } from 'crypto';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AiProviderService, OPENROUTER_METADATA_KEY } from '../../common/services/ai-provider.service';
import { ExchangeRateService } from '../../exchange-rate/exchange-rate.service';
import { StoreCreditDeductionService } from '../store-credit-engine/store-credit-deduction.service';
import { NotificationService } from '../notifications/notification.service';
import { PERCEPTION_MODEL } from '../sales-agent/model-variants';
import { displayOrderCode } from '../../common/utils/order-code.util';
import { fa } from '../../i18n/fa';
import {
  RECEIPT_CHECK_BUDGET_USD,
  RECEIPT_CHECK_JPEG_QUALITY,
  RECEIPT_CHECK_MAX_EDGE_PX,
  RECEIPT_CHECK_MAX_IMAGES,
  RECEIPT_CHECK_MAX_OUTPUT_TOKENS,
  RECEIPT_CHECK_TIMEOUT_MS,
  RECEIPT_VISION_FALLBACK_MODEL,
} from '../../common/constants/sales-ops.constants';
import { compareReceipt, ReceiptCheckResult, ReceiptExtraction } from './receipt-check.logic';

export const RECEIPT_CHECK_QUEUE = 'receipt-check';

const schema = z.object({
  amountToman: z.number().nullable(),
  dateTime: z.string().nullable(),
  destCardLast4: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  bankName: z.string().nullable(),
  isLikelyReceipt: z.boolean(),
  confidence: z.number(),
});

const PROMPT =
  'Iranian bank transfer receipt or Snapp Pay success screenshot. ' +
  'Extract amount in toman (if the receipt says rial, divide by 10), transfer time as ISO-8601 or null, ' +
  'destination card last 4 digits or null, tracking number or null, bank name or null. ' +
  'isLikelyReceipt is false when this is not a payment receipt. confidence is 0 to 1. Do not invent digits.';

@Injectable()
export class ReceiptCheckService {
  private readonly logger = new Logger(ReceiptCheckService.name);

  constructor(
    @InjectQueue(RECEIPT_CHECK_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ai: AiProviderService,
    private readonly rates: ExchangeRateService,
    private readonly credits: StoreCreditDeductionService,
    private readonly notifications: NotificationService,
  ) {}

  async enqueue(orderId: string): Promise<void> {
    try {
      await this.queue.add(
        'run',
        { orderId },
        { attempts: 2, removeOnComplete: true, removeOnFail: 200 },
      );
    } catch (err) {
      this.logger.error(`receipt check enqueue failed (order=${orderId})`, err as Error);
    }
  }

  async run(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        store: { select: { bankCards: { select: { cardNumber: true } } } },
        conversation: { select: { customerId: true } },
      },
    });
    if (!order?.receiptImageKey || order.receiptType === 'MANUAL_INFO') return;
    const keys = new Set(order.receiptImageKeys);
    keys.add(order.receiptImageKey);
    if (keys.size > RECEIPT_CHECK_MAX_IMAGES) return;

    const buffer = await this.storage.downloadImage(order.receiptImageKey);
    const hash = await perceptualOrSha(buffer);
    if (order.receiptHash === hash && order.receiptCheck) return;

    const duplicate = await this.prisma.order.findFirst({
      where: { storeId: order.storeId, receiptHash: hash, NOT: { id: order.id } },
      select: { id: true, orderCode: true },
    });
    if (duplicate) {
      await this.save(order.id, keys, hash, {
        match: 'DUPLICATE',
        overpaidToman: 0,
        duplicateOrderCode: displayOrderCode(duplicate),
        amountToman: null,
        destCardLast4: null,
        trackingNumber: null,
        bankName: null,
        cardOk: null,
        timeOk: null,
        reason: 'duplicate',
      });
      await this.tellSeller(order.storeId, order, 'DUPLICATE', displayOrderCode(duplicate));
      return;
    }

    if (!(await this.credits.canSpend(order.storeId))) {
      await this.save(order.id, keys, hash, unread('no_credit'));
      return;
    }
    if (order.receiptImageKey.toLowerCase().endsWith('.pdf')) {
      await this.save(order.id, keys, hash, unread('pdf'));
      await this.tellSeller(order.storeId, order, 'UNREADABLE');
      return;
    }

    const jpeg = await toJpeg(buffer);
    const vision = await this.read(jpeg);
    if (!vision) {
      await this.save(order.id, keys, hash, unread('vision_failed'));
      await this.tellSeller(order.storeId, order, 'UNREADABLE');
      return;
    }
    const last4s = order.store.bankCards
      .map((c) => c.cardNumber.replace(/\D/g, '').slice(-4))
      .filter((d) => d.length === 4);
    const result = compareReceipt({
      extraction: vision.extraction,
      expectedAmountToman: order.totalAmount,
      orderCreatedAt: order.createdAt,
      storeCardLast4: last4s,
    });
    result.costUsd = vision.costUsd;
    if (vision.costUsd > RECEIPT_CHECK_BUDGET_USD) {
      this.logger.warn(
        `receipt check cost ${vision.costUsd} USD exceeds ${RECEIPT_CHECK_BUDGET_USD} (order=${order.id})`,
      );
    }
    await this.save(order.id, keys, hash, result, vision.extraction.amountToman);
    await this.charge(order, vision);
    await this.tellSeller(order.storeId, order, result.match, result.duplicateOrderCode, result.overpaidToman);
    if (
      result.match === 'MISMATCH' &&
      result.overpaidToman === 0 &&
      result.amountToman != null &&
      order.conversation.customerId
    ) {
      await this.notifications.notifyBuyer({
        to: { customerId: order.conversation.customerId },
        template: 'RECEIPT_AMOUNT_MISMATCH',
        entityId: order.id,
        data: {
          orderId: order.id,
          receiptAmountToman: result.amountToman,
          orderAmountToman: order.totalAmount,
        },
      });
    }
  }

  private async read(
    jpeg: Buffer,
  ): Promise<{ extraction: ReceiptExtraction; costUsd: number; model: string; inTok: number; outTok: number } | null> {
    const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    const attempt = async (model: string) => {
      const result = await generateObject({
        maxRetries: 0,
        maxOutputTokens: RECEIPT_CHECK_MAX_OUTPUT_TOKENS,
        temperature: 0,
        abortSignal: AbortSignal.timeout(RECEIPT_CHECK_TIMEOUT_MS),
        model: this.ai.buildClient(undefined, { supportsStructuredOutputs: true })(model),
        schema,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', image: dataUrl },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      });
      const meta = result.providerMetadata?.[OPENROUTER_METADATA_KEY] as { cost?: number } | undefined;
      return {
        extraction: result.object,
        costUsd: typeof meta?.cost === 'number' ? meta.cost : 0,
        model,
        inTok: result.usage?.inputTokens ?? 0,
        outTok: result.usage?.outputTokens ?? 0,
      };
    };
    try {
      return await attempt(PERCEPTION_MODEL);
    } catch (err) {
      this.logger.error(`receipt vision failed (${PERCEPTION_MODEL})`, err as Error);
      try {
        return await attempt(RECEIPT_VISION_FALLBACK_MODEL);
      } catch (err2) {
        this.logger.error(`receipt vision fallback failed`, err2 as Error);
        return null;
      }
    }
  }

  private async charge(
    order: { id: string; storeId: string; conversation: { customerId: string } },
    vision: { costUsd: number; model: string; inTok: number; outTok: number },
  ) {
    if (vision.costUsd <= 0) return;
    try {
      const rate = await this.rates.getUsdtToman();
      const rawCostToman = Math.max(1, Math.ceil(vision.costUsd * rate));
      await this.credits.deductSafely({
        storeId: order.storeId,
        rawCostToman,
        kind: 'BUYER',
        event: {
          model: vision.model,
          kind: 'RECEIPT_CHECK',
          customerId: order.conversation.customerId,
          tokensInput: vision.inTok,
          tokensOutput: vision.outTok,
          costUsdMicros: Math.round(vision.costUsd * 1_000_000),
        },
      });
    } catch (err) {
      this.logger.error(`receipt check charge failed (order=${order.id})`, err as Error);
    }
  }

  private async save(
    orderId: string,
    keys: Set<string>,
    hash: string,
    result: ReceiptCheckResult,
    extracted?: number | null,
  ) {
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        receiptHash: hash,
        receiptImageKeys: [...keys].slice(0, RECEIPT_CHECK_MAX_IMAGES),
        receiptCheck: result as object,
        receiptExtractedAmountToman: extracted ?? null,
        receiptVerifiedMatch: result.match === 'OK',
      },
    });
  }

  private async tellSeller(
    storeId: string,
    order: { id: string; orderCode: string | null },
    match: ReceiptCheckResult['match'],
    duplicateCode?: string,
    overpaid = 0,
  ) {
    const code = displayOrderCode(order);
    const line =
      match === 'OK'
        ? fa.orderNotify.receiptOk(code)
        : match === 'DUPLICATE'
          ? fa.orderNotify.receiptDuplicate(code, duplicateCode ?? '')
          : match === 'MISMATCH'
            ? overpaid > 0
              ? fa.orderNotify.receiptOverpaid(code, overpaid)
              : fa.orderNotify.receiptMismatch(code)
            : fa.orderNotify.receiptUnreadable(code);
    await this.notifications.notifySeller({
      storeId,
      template: 'RECEIPT_CHECK',
      entityId: order.id,
      botText: line,
      dedupe: { key: `receipt-check:${order.id}:${match}`, ttlSeconds: 3600 },
    });
  }
}

function unread(reason: string): ReceiptCheckResult {
  return {
    match: 'UNREADABLE',
    overpaidToman: 0,
    amountToman: null,
    destCardLast4: null,
    trackingNumber: null,
    bankName: null,
    cardOk: null,
    timeOk: null,
    reason,
  };
}

async function perceptualOrSha(buffer: Buffer): Promise<string> {
  try {
    const sharp = (await import('sharp')).default;
    const raw = await sharp(buffer).resize(8, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
    let sum = 0;
    for (const p of raw) sum += p;
    const avg = sum / raw.length || 0;
    let bits = '';
    for (const p of raw) bits += p >= avg ? '1' : '0';
    return `ahash:${BigInt('0b' + bits).toString(16)}`;
  } catch {
    return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
  }
}

async function toJpeg(buffer: Buffer): Promise<Buffer> {
  try {
    const sharp = (await import('sharp')).default;
    return await sharp(buffer)
      .rotate()
      .resize({
        width: RECEIPT_CHECK_MAX_EDGE_PX,
        height: RECEIPT_CHECK_MAX_EDGE_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: RECEIPT_CHECK_JPEG_QUALITY })
      .toBuffer();
  } catch {
    return buffer;
  }
}
