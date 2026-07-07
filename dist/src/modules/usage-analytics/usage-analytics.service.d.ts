import { PrismaService } from '../../prisma/prisma.service';
import type { LimitHitType, UserSegment } from '@prisma/client';
export interface DateRange {
    from: Date;
    to: Date;
}
export declare function parseDateRange(from?: string, to?: string): DateRange;
export interface UserUsageRow {
    userId: string;
    phone: string | null;
    name: string | null;
    messages: number;
    avgMessagesPerDay: number;
    tokensInput: number;
    tokensOutput: number;
    avgTokensPerDay: number;
    costRial: number;
    costUsd: number;
    revenueRial: number;
    marginRial: number;
    mostUsedModel: string | null;
    segment: string | null;
}
export declare class UsageAnalyticsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getOverview(range: DateRange, compare: boolean): Promise<{
        current: {
            totalTokens: number;
            totalMessages: number;
            costRial: number;
            costUsd: number;
            revenueRial: number;
            marginRial: number;
            marginPct: number | null;
            avgTokensPerMessage: number;
            topModel: string;
        };
        previous: null;
        growth?: undefined;
    } | {
        current: {
            totalTokens: number;
            totalMessages: number;
            costRial: number;
            costUsd: number;
            revenueRial: number;
            marginRial: number;
            marginPct: number | null;
            avgTokensPerMessage: number;
            topModel: string;
        };
        previous: {
            totalTokens: number;
            totalMessages: number;
            costRial: number;
            costUsd: number;
            revenueRial: number;
            marginRial: number;
            marginPct: number | null;
            avgTokensPerMessage: number;
            topModel: string;
        };
        growth: {
            totalTokens: number | null;
            totalMessages: number | null;
            costRial: number | null;
            revenueRial: number | null;
        };
    }>;
    private computeOverview;
    getTimeseries(range: DateRange, granularity: 'day' | 'week' | 'month'): Promise<{
        date: string;
        tokens: number;
        messages: number;
        costRial: number;
        costUsd: number;
    }[] | {
        tokens: number;
        messages: number;
        costRial: number;
        costUsd: number;
        period: string;
    }[]>;
    getModelBreakdown(range: DateRange): Promise<{
        model: string;
        messages: number;
        tokensInput: number;
        tokensOutput: number;
        costRial: number;
        costUsd: number;
    }[]>;
    getTopicBreakdown(range: DateRange): Promise<{
        topicId: string | null;
        name: string;
        color: string | null;
        messages: number;
        pct: number;
    }[]>;
    getLimitHits(range: DateRange): Promise<{
        byType: {
            type: import("@prisma/client").$Enums.LimitHitType;
            count: number;
        }[];
        uniqueUsers: number;
    }>;
    logLimitHit(userId: string, type: LimitHitType): Promise<void>;
    getUsers(range: DateRange, segmentLabel?: string): Promise<UserUsageRow[]>;
    exportUsersCsv(range: DateRange, segmentLabel?: string): Promise<string>;
    getSegmentBreakdown(range: DateRange, compare: boolean): Promise<{
        current: {
            label: string;
            userCount: number;
            avgMessagesPerDay: number;
            medianMessagesPerDay: number;
            p90MessagesPerDay: number;
            avgTokensPerDay: number;
            medianTokensPerDay: number;
            p90TokensPerDay: number;
            costRial: number;
            revenueRial: number;
            marginRial: number;
            marginPct: number | null;
        }[];
        previous: null;
    } | {
        current: {
            label: string;
            userCount: number;
            avgMessagesPerDay: number;
            medianMessagesPerDay: number;
            p90MessagesPerDay: number;
            avgTokensPerDay: number;
            medianTokensPerDay: number;
            p90TokensPerDay: number;
            costRial: number;
            revenueRial: number;
            marginRial: number;
            marginPct: number | null;
        }[];
        previous: {
            label: string;
            userCount: number;
            avgMessagesPerDay: number;
            medianMessagesPerDay: number;
            p90MessagesPerDay: number;
            avgTokensPerDay: number;
            medianTokensPerDay: number;
            p90TokensPerDay: number;
            costRial: number;
            revenueRial: number;
            marginRial: number;
            marginPct: number | null;
        }[];
    }>;
    private computeSegmentBreakdown;
    private matchSegment;
    listSegments(): Promise<{
        id: string;
        createdAt: Date;
        isActive: boolean;
        updatedAt: Date;
        sortOrder: number;
        color: string | null;
        label: string;
        minMessagesPerDay: number | null;
        maxMessagesPerDay: number | null;
        minTokensPerDay: number | null;
        maxTokensPerDay: number | null;
    }[]>;
    createSegment(data: Omit<UserSegment, 'id' | 'createdAt' | 'updatedAt'>): Promise<{
        id: string;
        createdAt: Date;
        isActive: boolean;
        updatedAt: Date;
        sortOrder: number;
        color: string | null;
        label: string;
        minMessagesPerDay: number | null;
        maxMessagesPerDay: number | null;
        minTokensPerDay: number | null;
        maxTokensPerDay: number | null;
    }>;
    updateSegment(id: string, data: Partial<Omit<UserSegment, 'id'>>): Promise<{
        id: string;
        createdAt: Date;
        isActive: boolean;
        updatedAt: Date;
        sortOrder: number;
        color: string | null;
        label: string;
        minMessagesPerDay: number | null;
        maxMessagesPerDay: number | null;
        minTokensPerDay: number | null;
        maxTokensPerDay: number | null;
    }>;
    deleteSegment(id: string): Promise<{
        id: string;
        createdAt: Date;
        isActive: boolean;
        updatedAt: Date;
        sortOrder: number;
        color: string | null;
        label: string;
        minMessagesPerDay: number | null;
        maxMessagesPerDay: number | null;
        minTokensPerDay: number | null;
        maxTokensPerDay: number | null;
    }>;
}
