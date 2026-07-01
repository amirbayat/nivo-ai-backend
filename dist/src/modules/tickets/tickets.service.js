"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TicketsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../../prisma/prisma.service");
const fa_1 = require("../../i18n/fa");
let TicketsService = class TicketsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(userId, dto) {
        const ticket = await this.prisma.supportTicket.create({
            data: {
                userId,
                subject: dto.subject,
                body: dto.body,
                priority: dto.priority ?? client_1.TicketPriority.NORMAL,
            },
        });
        return { message: fa_1.fa.ticket.created, ticket };
    }
    async findByUser(userId) {
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
    async findOneByUser(userId, ticketId) {
        const ticket = await this.prisma.supportTicket.findUnique({
            where: { id: ticketId },
            include: {
                replies: { orderBy: { createdAt: 'asc' } },
            },
        });
        if (!ticket)
            throw new common_1.NotFoundException(fa_1.fa.ticket.notFound);
        if (ticket.userId !== userId)
            throw new common_1.ForbiddenException(fa_1.fa.errors.forbidden);
        return { ticket };
    }
    async addUserReply(userId, ticketId, body) {
        const ticket = await this.prisma.supportTicket.findUnique({
            where: { id: ticketId },
        });
        if (!ticket)
            throw new common_1.NotFoundException(fa_1.fa.ticket.notFound);
        if (ticket.userId !== userId)
            throw new common_1.ForbiddenException(fa_1.fa.errors.forbidden);
        if (ticket.status === client_1.TicketStatus.CLOSED)
            throw new common_1.ForbiddenException(fa_1.fa.ticket.closed);
        const reply = await this.prisma.ticketReply.create({
            data: {
                ticketId,
                body,
                fromAdmin: false,
            },
        });
        return { reply };
    }
    async findAll(status) {
        const where = status ? { status: status } : {};
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
    async findOne(ticketId) {
        const ticket = await this.prisma.supportTicket.findUnique({
            where: { id: ticketId },
            include: {
                user: { select: { id: true, phone: true, name: true } },
                replies: { orderBy: { createdAt: 'asc' } },
            },
        });
        if (!ticket)
            throw new common_1.NotFoundException(fa_1.fa.ticket.notFound);
        return { ticket };
    }
    async addAdminReply(ticketId, body, adminNote) {
        const ticket = await this.prisma.supportTicket.findUnique({
            where: { id: ticketId },
        });
        if (!ticket)
            throw new common_1.NotFoundException(fa_1.fa.ticket.notFound);
        const [reply] = await this.prisma.$transaction([
            this.prisma.ticketReply.create({
                data: { ticketId, body, fromAdmin: true },
            }),
            this.prisma.supportTicket.update({
                where: { id: ticketId },
                data: {
                    status: client_1.TicketStatus.IN_PROGRESS,
                    ...(adminNote !== undefined ? { adminNote } : {}),
                },
            }),
        ]);
        return { reply };
    }
    async updateStatus(ticketId, status, priority, adminNote) {
        const ticket = await this.prisma.supportTicket.findUnique({
            where: { id: ticketId },
        });
        if (!ticket)
            throw new common_1.NotFoundException(fa_1.fa.ticket.notFound);
        const updated = await this.prisma.supportTicket.update({
            where: { id: ticketId },
            data: {
                ...(status !== undefined ? { status } : {}),
                ...(priority !== undefined ? { priority } : {}),
                ...(adminNote !== undefined ? { adminNote } : {}),
            },
        });
        return { message: fa_1.fa.ticket.updated, ticket: updated };
    }
};
exports.TicketsService = TicketsService;
exports.TicketsService = TicketsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TicketsService);
//# sourceMappingURL=tickets.service.js.map