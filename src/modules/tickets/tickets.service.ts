import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TicketPriority, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { fa } from '../../i18n/fa';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { AdminNotificationsService } from '../admin-notifications/admin-notifications.service';

export interface TicketAdminRepliedEvent {
  ticketId: string;
  body: string;
}
export interface TicketStatusChangedEvent {
  ticketId: string;
  status: TicketStatus;
}

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);
  // docs/PRD-seller-bot-support-agent.md بخش ۵.۳ — رله‌ی جواب ادمین به بات فروشنده بدون وابستگی
  // چرخه‌ای TicketsModule ↔ SellerSupportModule: ماژول seller-support listener ثبت می‌کند
  // (معادل ساده‌ی event؛ پکیج event-emitter در پروژه نیست). خطای listener هرگز مسیر اصلی را نمی‌شکند
  private readonly adminRepliedListeners: ((e: TicketAdminRepliedEvent) => Promise<void> | void)[] = [];
  private readonly statusChangedListeners: ((e: TicketStatusChangedEvent) => Promise<void> | void)[] = [];

  onAdminReplied(fn: (e: TicketAdminRepliedEvent) => Promise<void> | void): void {
    this.adminRepliedListeners.push(fn);
  }

  onStatusChanged(fn: (e: TicketStatusChangedEvent) => Promise<void> | void): void {
    this.statusChangedListeners.push(fn);
  }

  private emit<T>(listeners: ((e: T) => Promise<void> | void)[], event: T): void {
    for (const fn of listeners) {
      Promise.resolve()
        .then(() => fn(event))
        .catch((err) => this.logger.error('ticket listener failed', err));
    }
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly adminNotifications: AdminNotificationsService,
  ) {}

  async create(userId: string, userPhone: string, dto: CreateTicketDto) {
    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        subject: dto.subject,
        body: dto.body,
        priority: dto.priority ?? TicketPriority.NORMAL,
      },
    });

    // نوتیف ادمین — docs/PRD-admin-notifications-and-mobile.md بخش ۴. فایر-اند-فورگت، شکستش
    // نباید ثبت تیکت کاربر را fail کند
    this.adminNotifications
      .notify(
        'TICKET_CREATED',
        fa.adminNotification.ticketTitle,
        fa.adminNotification.ticketBody(dto.subject, userPhone),
        { ticketId: ticket.id, userId },
      )
      .catch((err) =>
        this.logger.error(
          `admin notification failed for ticket=${ticket.id}`,
          err,
        ),
      );

    return { message: fa.ticket.created, ticket };
  }

  async findByUser(userId: string) {
    const tickets = await this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        subject: true,
        status: true,
        priority: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { tickets };
  }

  async findOneByUser(userId: string, ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        replies: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!ticket) throw new NotFoundException(fa.ticket.notFound);
    if (ticket.userId !== userId)
      throw new ForbiddenException(fa.errors.forbidden);

    return { ticket };
  }

  async addUserReply(userId: string, ticketId: string, body: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) throw new NotFoundException(fa.ticket.notFound);
    if (ticket.userId !== userId)
      throw new ForbiddenException(fa.errors.forbidden);
    if (ticket.status === TicketStatus.CLOSED)
      throw new ForbiddenException(fa.ticket.closed);

    const reply = await this.prisma.ticketReply.create({
      data: {
        ticketId,
        body,
        fromAdmin: false,
      },
    });

    return { reply };
  }

  // ── Admin methods ────────────────────────────────────────────────────────────

  async findAll(status?: string) {
    const where = status ? { status: status as TicketStatus } : {};

    const tickets = await this.prisma.supportTicket.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, phone: true, name: true },
        },
        replies: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return { tickets };
  }

  async findOne(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        user: { select: { id: true, phone: true, name: true } },
        replies: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!ticket) throw new NotFoundException(fa.ticket.notFound);

    return { ticket };
  }

  async addAdminReply(ticketId: string, body: string, adminNote?: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) throw new NotFoundException(fa.ticket.notFound);

    const [reply] = await this.prisma.$transaction([
      this.prisma.ticketReply.create({
        data: { ticketId, body, fromAdmin: true },
      }),
      this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: TicketStatus.IN_PROGRESS,
          ...(adminNote !== undefined ? { adminNote } : {}),
        },
      }),
    ]);

    this.emit(this.adminRepliedListeners, { ticketId, body });
    return { reply };
  }

  // docs/PRD-seller-bot-support-agent.md بخش ۴ — تیکت از بات فروشنده؛ اگر تیکت باز همان فروشگاه
  // هست پیام به همان اضافه می‌شود (تیکت تکراری ساخته نمی‌شود)
  async createFromSellerBot(
    store: { id: string; name: string; sellerId: string },
    opts: { subject: string; body: string; aiSummary: string },
  ) {
    const open = await this.prisma.supportTicket.findFirst({
      where: {
        storeId: store.id,
        category: 'SELLER',
        channel: 'SELLER_BOT',
        status: { in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (open) {
      await this.prisma.ticketReply.create({
        data: { ticketId: open.id, body: opts.body, fromAdmin: false },
      });
      return { ticket: open, created: false as const };
    }
    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId: store.sellerId,
        storeId: store.id,
        category: 'SELLER',
        channel: 'SELLER_BOT',
        subject: opts.subject,
        body: opts.body,
        aiSummary: opts.aiSummary,
      },
    });
    this.adminNotifications
      .notify(
        'TICKET_CREATED',
        fa.adminNotification.ticketTitle,
        fa.adminNotification.ticketBody(opts.subject, store.name),
        { ticketId: ticket.id, storeId: store.id },
      )
      .catch((err) =>
        this.logger.error(`admin notification failed for ticket=${ticket.id}`, err),
      );
    return { ticket, created: true as const };
  }

  // «✅ مشکلم حل شد» از سمت فروشنده — عمداً event وضعیت نمی‌فرستد (فروشنده خودش زده، پیام
  // «ادمین بست» نباید برایش برگردد)
  async resolveBySeller(storeId: string, ticketId: string) {
    const res = await this.prisma.supportTicket.updateMany({
      where: { id: ticketId, storeId, status: { in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS] } },
      data: { status: TicketStatus.RESOLVED },
    });
    return res.count > 0;
  }

  async updateStatus(
    ticketId: string,
    status?: TicketStatus,
    priority?: TicketPriority,
    adminNote?: string,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) throw new NotFoundException(fa.ticket.notFound);

    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        ...(status !== undefined ? { status } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(adminNote !== undefined ? { adminNote } : {}),
      },
    });

    if (
      status !== undefined &&
      status !== ticket.status &&
      (status === TicketStatus.RESOLVED || status === TicketStatus.CLOSED)
    ) {
      this.emit(this.statusChangedListeners, { ticketId, status });
    }
    return { message: fa.ticket.updated, ticket: updated };
  }
}
