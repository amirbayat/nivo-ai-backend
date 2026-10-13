// فقط برای specها — ساخت سریع Perception/Memory/Facts
import { neutralPerception, type Perception } from './perception.schema';
import { emptySlots } from './sales-memory.util';
import type { SalesMemory, ServerFacts } from './sales-machine.types';

export function perception(over: Partial<Perception> = {}): Perception {
  return { ...neutralPerception({ interests: [] }), ...over };
}

export function memory(over: Partial<SalesMemory> = {}): SalesMemory {
  return {
    version: 1,
    stage: 'OPENING',
    stageEnteredTurn: 0,
    turn: 0,
    lastGoal: null,
    slots: emptySlots(),
    needSummary: null,
    objections: [],
    interests: [],
    askedQuestions: [],
    discoveryQuestionsAsked: 0,
    lastAgentQuestion: null,
    lastCloseOffer: null,
    lastQuickReplies: [],
    sentimentTrail: [],
    irrelevantStreak: 0,
    lastCustomerMessageAt: null,
    ...over,
  };
}

export function facts(over: Partial<ServerFacts> = {}): ServerFacts {
  return {
    conversationState: 'BROWSING',
    cartItemCount: 0,
    leadCaptureOnly: false,
    catalogSize: 20,
    hasWebsiteUrl: false,
    nowIso: '2026-10-13T10:00:00.000Z',
    ...over,
  };
}
