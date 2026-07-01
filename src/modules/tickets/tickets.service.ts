import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { TicketPriority, TicketStatus } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { fa } from '../../i18n/fa'
import { CreateTicketDto } from './dto/create-ticket.dto'

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateTicketDto) {
    const ticket = await this.prisma.supportTicket.create({
      data: {
        userId,
        subject: dto.subject,
        body: dto.body,
        priority: dto.priority ?? TicketPriority.NORMAL,
      },
    })
    return { message: fa.ticket.created, ticket }
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
    })
    return { tickets }
  }

  async findOneByUser(userId: string, ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        replies: { orderBy: { createdAt: 'asc' } },
      },
    })

    if (!ticket) throw new NotFoundException(fa.ticket.notFound)
    if (ticket.userId !== userId) throw new ForbiddenException(fa.errors.forbidden)

    return { ticket }
  }

  async addUserReply(userId: string, ticketId: string, body: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    })

    if (!ticket) throw new NotFoundException(fa.ticket.notFound)
    if (ticket.userId !== userId) throw new ForbiddenException(fa.errors.forbidden)
    if (ticket.status === TicketStatus.CLOSED) throw new ForbiddenException(fa.ticket.closed)

    const reply = await this.prisma.ticketReply.create({
      data: {
        ticketId,
        body,
        fromAdmin: false,
      },
    })

    return { reply }
  }

  // ── Admin methods ────────────────────────────────────────────────────────────

  async findAll(status?: string) {
    const where = status ? { status: status as TicketStatus } : {}

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
    })

    return { tickets }
  }

  async findOne(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        user: { select: { id: true, phone: true, name: true } },
        replies: { orderBy: { createdAt: 'asc' } },
      },
    })

    if (!ticket) throw new NotFoundException(fa.ticket.notFound)

    return { ticket }
  }

  async addAdminReply(ticketId: string, body: string, adminNote?: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    })

    if (!ticket) throw new NotFoundException(fa.ticket.notFound)

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
    ])

    return { reply }
  }

  async updateStatus(
    ticketId: string,
    status?: TicketStatus,
    priority?: TicketPriority,
    adminNote?: string,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    })

    if (!ticket) throw new NotFoundException(fa.ticket.notFound)

    const updated = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        ...(status !== undefined ? { status } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(adminNote !== undefined ? { adminNote } : {}),
      },
    })

    return { message: fa.ticket.updated, ticket: updated }
  }
}
