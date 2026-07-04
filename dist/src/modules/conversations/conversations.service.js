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
exports.ConversationsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const fa_1 = require("../../i18n/fa");
let ConversationsService = class ConversationsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    create(userId, dto) {
        return this.prisma.conversation.create({
            data: { userId, ...dto },
        });
    }
    async findAll(userId, query) {
        const limit = query.limit ?? 20;
        const { cursor } = query;
        const items = await this.prisma.conversation.findMany({
            where: { userId, isArchived: false },
            orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: {
                id: true,
                title: true,
                model: true,
                totalTokens: true,
                lastMessageAt: true,
                createdAt: true,
            },
        });
        const hasMore = items.length > limit;
        const data = hasMore ? items.slice(0, limit) : items;
        return {
            items: data,
            nextCursor: hasMore ? data[data.length - 1].id : null,
        };
    }
    async findOne(id, userId) {
        const conversation = await this.prisma.conversation.findUnique({
            where: { id },
            include: {
                messages: {
                    orderBy: { createdAt: 'asc' },
                    take: 50,
                    select: {
                        id: true,
                        conversationId: true,
                        role: true,
                        content: true,
                        images: true,
                        tokensInput: true,
                        tokensOutput: true,
                        createdAt: true,
                        feedback: { select: { vote: true, comment: true } },
                    },
                },
            },
        });
        if (!conversation)
            throw new common_1.NotFoundException(fa_1.fa.conversations.notFound);
        if (conversation.userId !== userId)
            throw new common_1.ForbiddenException(fa_1.fa.conversations.forbidden);
        return conversation;
    }
    async update(id, userId, dto) {
        await this.assertOwnership(id, userId);
        return this.prisma.conversation.update({ where: { id }, data: dto });
    }
    async archive(id, userId) {
        await this.assertOwnership(id, userId);
        await this.prisma.conversation.update({
            where: { id },
            data: { isArchived: true },
        });
    }
    async assertOwnership(id, userId) {
        const conv = await this.prisma.conversation.findUnique({
            where: { id },
            select: { userId: true },
        });
        if (!conv)
            throw new common_1.NotFoundException(fa_1.fa.conversations.notFound);
        if (conv.userId !== userId)
            throw new common_1.ForbiddenException(fa_1.fa.conversations.forbidden);
    }
};
exports.ConversationsService = ConversationsService;
exports.ConversationsService = ConversationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ConversationsService);
//# sourceMappingURL=conversations.service.js.map