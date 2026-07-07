import type { Response } from 'express';
import { UsageAnalyticsService } from './usage-analytics.service';
import { TopicService } from './topic.service';
export declare class UsageAnalyticsController {
    private readonly analytics;
    private readonly topics;
    constructor(analytics: UsageAnalyticsService, topics: TopicService);
    getOverview(from?: string, to?: string, compareTo?: string): Promise<{
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
    getTimeseries(from?: string, to?: string, granularity?: 'day' | 'week' | 'month'): Promise<{
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
    getModels(from?: string, to?: string): Promise<{
        model: string;
        messages: number;
        tokensInput: number;
        tokensOutput: number;
        costRial: number;
        costUsd: number;
    }[]>;
    getTopicsBreakdown(from?: string, to?: string): Promise<{
        topicId: string | null;
        name: string;
        color: string | null;
        messages: number;
        pct: number;
    }[]>;
    getLimitHits(from?: string, to?: string): Promise<{
        byType: {
            type: import("@prisma/client").$Enums.LimitHitType;
            count: number;
        }[];
        uniqueUsers: number;
    }>;
    getUsers(from?: string, to?: string, segment?: string): Promise<import("./usage-analytics.service").UserUsageRow[]>;
    exportUsers(res: Response, from?: string, to?: string, segment?: string): Promise<void>;
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
    getSegmentBreakdown(from?: string, to?: string, compareTo?: string): Promise<{
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
    createSegment(body: {
        label: string;
        minMessagesPerDay?: number | null;
        maxMessagesPerDay?: number | null;
        minTokensPerDay?: number | null;
        maxTokensPerDay?: number | null;
        color?: string | null;
        sortOrder?: number;
        isActive?: boolean;
    }): Promise<{
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
    updateSegment(id: string, body: Record<string, unknown>): Promise<{
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
export declare class TopicController {
    private readonly topics;
    constructor(topics: TopicService);
    list(): Promise<{
        name: string;
        id: string;
        createdAt: Date;
        isActive: boolean;
        sortOrder: number;
        keywords: import("@prisma/client/runtime/client").JsonValue;
        color: string | null;
    }[]>;
    create(body: {
        name: string;
        keywords: string[];
        color?: string;
        sortOrder?: number;
    }): Promise<{
        name: string;
        id: string;
        createdAt: Date;
        isActive: boolean;
        sortOrder: number;
        keywords: import("@prisma/client/runtime/client").JsonValue;
        color: string | null;
    }>;
    update(id: string, body: Record<string, unknown>): Promise<{
        name: string;
        id: string;
        createdAt: Date;
        isActive: boolean;
        sortOrder: number;
        keywords: import("@prisma/client/runtime/client").JsonValue;
        color: string | null;
    }>;
    remove(id: string): Promise<void>;
}
