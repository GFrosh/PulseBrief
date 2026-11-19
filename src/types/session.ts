/**
 * PulseBrief — shared domain types.
 *
 * Every inference artifact in the product is tagged with the engine that
 * produced it (`LOCAL_NANO` vs `CLOUD_GEMINI`) so the UI can render the
 * hybrid routing story honestly, straight from the data.
 */

export type RoutingMode = 'AUTO_HYBRID' | 'FORCE_LOCAL' | 'FORCE_CLOUD';

export type NanoAvailability = 'AVAILABLE' | 'DOWNLOADING' | 'UNAVAILABLE' | 'CHECKING';

export type Speaker = 'You (Interviewer)' | 'Guest (Prospect)';

/** Which physical engine answered a call. */
export type InferenceSource = 'LOCAL_NANO' | 'CLOUD_GEMINI' | 'CLOUD_FALLBACK' | 'DEMO_ENGINE';

export type GoalStatus = 'pending' | 'partial' | 'covered';

export interface SessionGoal {
  id: string;
  text: string;
  status: GoalStatus;
  evidenceSnippet?: string;
  updatedBy?: 'LOCAL_NANO' | 'CLOUD_GEMINI';
  latencyMs?: number;
  /** Domain keywords supplied by a scenario, used by the local matching engine. */
  keywords?: string[];
}

export type NudgeTrigger = 'VAGUE_ANSWER' | 'UNANSWERED_QUESTION' | 'FOLLOW_UP_OPPORTUNITY';

export interface CoPilotNudge {
  id: string;
  timestamp: string;
  triggerType: NudgeTrigger;
  detectedContext: string;
  suggestedQuestion: string;
  source: 'LOCAL_NANO' | 'CLOUD_FALLBACK';
  latencyMs: number;
  dismissed?: boolean;
  asked?: boolean;
}

export interface TranscriptSegment {
  id: string;
  speaker: Speaker;
  text: string;
  timestamp: string;
  isFinal: boolean;
  /** Goal ids that this segment was cited as evidence for (for inline highlighting). */
  matchedGoalIds?: string[];
  /** True when the segment contains PII that will be masked before cloud escalation. */
  containsPii?: boolean;
}

export interface InferenceTelemetry {
  localNanoCalls: number;
  cloudGeminiCalls: number;
  piiEntitiesRedactedLocally: number;
  localLatenciesMs: number[];
  cloudLatencyMs: number | null;
  estimatedTokensSavedLocally: number;
}

export type SyncStatus = 'SYNCED' | 'QUEUED_OFFLINE' | 'LOCAL_ONLY' | 'SAVING';

export interface CrmFields {
  painPoint: string;
  currentStack: string;
  budgetAuthority: string;
  timeline: string;
  nextStep: string;
}

export interface PostCallBrief {
  title: string;
  createdAt: string;
  sanitizedTranscript: string;
  rawTranscript: string;
  redactionCount: number;
  executiveSummary: string[];
  goalOutcomes: SessionGoal[];
  crmFields: CrmFields;
  followUpEmailDraft: string;
  telemetry: InferenceTelemetry;
  syncStatus: SyncStatus;
  engine: InferenceSource;
  company?: string;
  contact?: string;
  cloudLatencyMs: number;
}

/** One line in the hybrid routing audit trail. */
export interface ActivityEntry {
  id: string;
  at: string;
  source: InferenceSource;
  operation: string;
  detail: string;
  latencyMs: number;
}

export interface InferenceMeta {
  source: InferenceSource;
  latencyMs: number;
  tokens: number;
  fallbackReason?: string;
}

export interface InferenceResult<T> {
  data: T;
  meta: InferenceMeta;
}

export interface ScenarioGoalSeed {
  id: string;
  text: string;
  /** Keywords used by the deterministic demo engine for local matching. */
  keywords: string[];
}

export interface ScenarioLine {
  speaker: Speaker;
  text: string;
  /** Pause before the line is spoken, in ms at 1x speed. */
  gapMs: number;
}

export interface Scenario {
  id: 'LOGISTICS_DISCOVERY' | 'TECH_SCREEN' | 'CUSTOM';
  label: string;
  shortLabel: string;
  company: string;
  contact: string;
  role: string;
  goals: ScenarioGoalSeed[];
  lines: ScenarioLine[];
}
