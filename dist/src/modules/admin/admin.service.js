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
exports.AdminService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const redis_service_1 = require("../../redis/redis.service");
const fa_1 = require("../../i18n/fa");
const LIMIT_TTL = {
    '1h': 3_600,
    '3h': 10_800,
    '6h': 21_600,
    daily: 86_400,
};
function manualLimitKey(userId) { return `manual_limit:${userId}`; }
let AdminService = class AdminService {
    prisma;
    redis;
    constructor(prisma, redis) {
        this.prisma = prisma;
        this.redis = redis;
    }
    async getDashboard() {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const [totalUsers, activeUsers, revenueAll, revenueMrr, totalConversations, todayConversations,] = await Promise.all([
            this.prisma.user.count(),
            this.prisma.user.count({
                where: { conversations: { some: { lastMessageAt: { gte: thirtyDaysAgo } } } },
            }),
            this.prisma.payment.aggregate({
                where: { status: 'COMPLETED' },
                _sum: { amount: true },
            }),
            this.prisma.payment.aggregate({
                where: { status: 'COMPLETED', createdAt: { gte: startOfMonth } },
                _sum: { amount: true },
            }),
            this.prisma.conversation.count(),
            this.prisma.conversation.count({ where: { createdAt: { gte: startOfToday } } }),
        ]);
        return {
            totalUsers,
            activeUsers,
            totalRevenue: revenueAll._sum.amount ?? 0,
            mrr: revenueMrr._sum.amount ?? 0,
            totalConversations,
            todayConversations,
        };
    }
    async getUsers(page, limit, search) {
        const skip = (page - 1) * limit;
        const where = search ? { phone: { contains: search } } : {};
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const daysPassed = now.getDate();
        const [users, total, monthlyRevenue, monthlyCost] = await Promise.all([
            this.prisma.user.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    phone: true,
                    name: true,
                    role: true,
                    isActive: true,
                    createdAt: true,
                    subscription: {
                        select: {
                            status: true,
                            periodEnd: true,
                            periodStart: true,
                            plan: { select: { name: true, priceMonthly: true } },
                        },
                    },
                },
            }),
            this.prisma.user.count({ where }),
            this.prisma.payment.groupBy({
                by: ['userId'],
                where: { status: 'COMPLETED', createdAt: { gte: startOfMonth } },
                _sum: { amount: true },
            }),
            this.prisma.dailyUsage.groupBy({
                by: ['userId'],
                where: { date: { gte: startOfMonth } },
                _sum: { costRial: true },
            }),
        ]);
        const revenueMap = new Map(monthlyRevenue.map(r => [r.userId, r._sum.amount ?? 0]));
        const costMap = new Map(monthlyCost.map(r => [r.userId, r._sum.costRial ?? 0]));
        const enriched = users.map(u => {
            const charged = revenueMap.get(u.id) ?? 0;
            const aiCost = costMap.get(u.id) ?? 0;
            const monthlyBudget = Math.floor((u.subscription?.plan.priceMonthly ?? 0) * 0.7);
            const expectedByNow = Math.floor((monthlyBudget * daysPassed) / daysInMonth);
            const ratio = expectedByNow > 0 ? aiCost / expectedByNow : 0;
            let category = 'inactive';
            if (aiCost > 0) {
                if (ratio >= 1.5)
                    category = 'heavy';
                else if (ratio >= 0.5)
                    category = 'moderate';
                else
                    category = 'light';
            }
            return { ...u, chargedThisMonth: charged, aiCostThisMonth: aiCost, expectedByNow, category };
        });
        return { users: enriched, total, page, limit };
    }
    async updateUser(userId, data) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            throw new common_1.NotFoundException(fa_1.fa.admin.userNotFound);
        const updated = await this.prisma.user.update({
            where: { id: userId },
            data,
            select: { id: true, phone: true, name: true, role: true, isActive: true },
        });
        return { message: fa_1.fa.admin.userUpdated, user: updated };
    }
    async getTokenStats() {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const [todayStats, monthStats] = await Promise.all([
            this.prisma.dailyUsage.aggregate({
                where: { date: { gte: startOfToday } },
                _sum: { freeTokensUsed: true, paidTokensUsed: true, requestsCount: true },
            }),
            this.prisma.dailyUsage.aggregate({
                where: { date: { gte: startOfMonth } },
                _sum: { freeTokensUsed: true, paidTokensUsed: true },
            }),
        ]);
        return {
            today: {
                totalFree: todayStats._sum.freeTokensUsed ?? 0,
                totalPaid: todayStats._sum.paidTokensUsed ?? 0,
                requests: todayStats._sum.requestsCount ?? 0,
            },
            thisMonth: {
                totalFree: monthStats._sum.freeTokensUsed ?? 0,
                totalPaid: monthStats._sum.paidTokensUsed ?? 0,
            },
        };
    }
    async getCostChart(days = 30) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        since.setHours(0, 0, 0, 0);
        const [costRows, revenueRows] = await Promise.all([
            this.prisma.dailyUsage.groupBy({
                by: ['date'],
                where: { date: { gte: since } },
                _sum: { costRial: true },
                orderBy: { date: 'asc' },
            }),
            this.prisma.$queryRaw `
        SELECT DATE_TRUNC('day', "createdAt") AS day, SUM(amount)::bigint AS revenue
        FROM payments
        WHERE status = 'COMPLETED' AND "createdAt" >= ${since}
        GROUP BY DATE_TRUNC('day', "createdAt")
        ORDER BY day ASC
      `,
        ]);
        const revenueMap = new Map(revenueRows.map(r => [r.day.toISOString().slice(0, 10), Number(r.revenue)]));
        return costRows.map(r => ({
            date: r.date.toISOString().slice(0, 10),
            aiCostRial: r._sum.costRial ?? 0,
            revenueToman: revenueMap.get(r.date.toISOString().slice(0, 10)) ?? 0,
        }));
    }
    async getPricingAlert() {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const [revenueRow, costRow] = await Promise.all([
            this.prisma.payment.aggregate({
                where: { status: 'COMPLETED', createdAt: { gte: startOfMonth } },
                _sum: { amount: true },
            }),
            this.prisma.dailyUsage.aggregate({
                where: { date: { gte: startOfMonth } },
                _sum: { costRial: true },
            }),
        ]);
        const monthlyRevenue = revenueRow._sum.amount ?? 0;
        const monthlyAiCost = costRow._sum.costRial ?? 0;
        const ratio = monthlyRevenue > 0 ? monthlyAiCost / monthlyRevenue : 0;
        let alertLevel = 'safe';
        let suggestion = null;
        if (ratio >= 0.75) {
            alertLevel = 'critical';
            const targetRatio = 0.55;
            const suggestedMultiplier = ratio / targetRatio;
            suggestion = [
                `هزینه AI این ماه ${(ratio * 100).toFixed(1)}٪ درآمد است (آستانه: ۷۵٪).`,
                `برای رسیدن به نسبت سالم ۵۵٪، پیشنهاد می‌شود قیمت پلن‌ها را حدود ${((suggestedMultiplier - 1) * 100).toFixed(0)}٪ افزایش دهید.`,
            ].join(' ');
        }
        else if (ratio >= 0.60) {
            alertLevel = 'warning';
            suggestion = `هزینه AI این ماه ${(ratio * 100).toFixed(1)}٪ درآمد است — نزدیک به آستانه هشدار. مراقب باشید.`;
        }
        return {
            monthlyRevenueToman: monthlyRevenue,
            monthlyAiCostRial: monthlyAiCost,
            aiCostRatio: Math.round(ratio * 1000) / 10,
            alertLevel,
            suggestion,
        };
    }
    async setManualLimit(userId, type, reason) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            throw new common_1.NotFoundException(fa_1.fa.admin.userNotFound);
        const ttl = LIMIT_TTL[type];
        const expiresAt = Date.now() + ttl * 1000;
        await this.redis.set(manualLimitKey(userId), JSON.stringify({ type, reason: reason ?? '', expiresAt }), 'EX', ttl);
        return { success: true, expiresAt: new Date(expiresAt).toISOString() };
    }
    async removeManualLimit(userId) {
        await this.redis.del(manualLimitKey(userId));
        return { success: true };
    }
    async getManualLimit(userId) {
        const raw = await this.redis.get(manualLimitKey(userId));
        if (!raw)
            return null;
        return JSON.parse(raw);
    }
    async changeUserPlan(userId, planId) {
        const [user, plan] = await Promise.all([
            this.prisma.user.findUnique({ where: { id: userId } }),
            this.prisma.plan.findUnique({ where: { id: planId } }),
        ]);
        if (!user)
            throw new common_1.NotFoundException(fa_1.fa.admin.userNotFound);
        if (!plan)
            throw new common_1.NotFoundException(fa_1.fa.plans.notFound);
        const now = new Date();
        const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
        const sub = await this.prisma.subscription.upsert({
            where: { userId },
            create: { userId, planId, periodStart: now, periodEnd, status: 'ACTIVE' },
            update: { planId, periodStart: now, periodEnd, status: 'ACTIVE', cancelAtPeriodEnd: false },
        });
        await this.redis.del(`plan:${userId}`);
        return { success: true, subscription: sub };
    }
    async getRevenueStats() {
        const rows = await this.prisma.$queryRaw `
      SELECT
        TO_CHAR(DATE_TRUNC('month', "createdAt"), 'YYYY-MM') AS month,
        SUM(amount)::bigint AS revenue,
        COUNT(*)::bigint AS count
      FROM payments
      WHERE status = 'COMPLETED'
        AND "createdAt" >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', "createdAt")
      ORDER BY DATE_TRUNC('month', "createdAt") ASC
    `;
        return rows.map(r => ({
            month: r.month,
            revenue: Number(r.revenue),
            count: Number(r.count),
        }));
    }
};
exports.AdminService = AdminService;
exports.AdminService = AdminService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService])
], AdminService);
//# sourceMappingURL=admin.service.js.map