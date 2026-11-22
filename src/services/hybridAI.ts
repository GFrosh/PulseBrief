import {
  GoogleAIBackend,
  InferenceMode,
  getAI,
  getGenerativeModel,
  type AI,
  type GenerativeModel,
  type HybridParams,
  type ModelParams,
} from 'firebase/ai';
import { app, isFirebaseConfigured } from '../config/firebase';
import type {
  CoPilotNudge,
  CrmFields,
  InferenceResult,
  InferenceSource,
  InferenceTelemetry,
  NanoAvailability,
  PostCallBrief,
  RoutingMode,
  SessionGoal,
} from '../types/session';

/* ==========================================================================
   PulseBrief — hybrid inference core
   --------------------------------------------------------------------------
   Four operations, two engines, one rule: the transcript never leaves the
   device until PII has been masked locally.

     Op 1  evaluateLiveGoals        -> on-device, every final transcript segment
     Op 2  generateLiveFollowUpNudge-> on-device, sub-500ms target
     Op 3  redactPiiLocally         -> on-device + deterministic regex safety net
     Op 4  synthesizePostCallBrief  -> cloud Gemini, sanitized text only

   When Firebase is not configured (or VITE_DEMO_ENGINE=true) the same four
   operations run against a deterministic local simulator so the product is
   fully demoable offline. Real calls are used whenever credentials exist.
   ========================================================================== */

export const MODEL_EDGE = 'gemini-3.5-flash-lite';
export const MODEL_CLOUD = 'gemini-3.8-flash';

const FORCE_DEMO = (import.meta.env.VITE_DEMO_ENGINE ?? '') === 'true';
export const isDemoEngine = !isFirebaseConfigured || FORCE_DEMO;

/** Automated capture mode trims only the cosmetic pacing delays. */
const CAPTURE_MODE =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('capture') === '1';

export const engineLabel = isDemoEngine ? 'Simulated Nano' : 'Firebase AI Logic';
export const engineDetail = isDemoEngine
  ? 'No Firebase project configured — deterministic local engine'
  : `Gemini Nano + ${MODEL_CLOUD} via Firebase AI Logic`;

/* --------------------------------------------------------------------------
   On-device capability detection
   -------------------------------------------------------------------------- */

export interface NanoStatus {
  status: NanoAvailability;
  detail: string;
  api: 'prompt-api' | 'firebase-ai' | 'none';
}

type PromptApiWindow = Window & {
  LanguageModel?: {
    availability?: () => Promise<string>;
    capabilities?: () => Promise<{ available?: string }>;
  };
  ai?: {
    languageModel?: {
      availability?: () => Promise<string>;
      capabilities?: () => Promise<{ available?: string }>;
    };
  };
};

/**
 * Detects Gemini Nano 4 through Chrome's built-in Prompt API.
 *
 * Chrome reports `available | downloadable | downloading | unavailable`; older
 * builds expose `capabilities()` with `readily | after-download | no`. Either
 * shape is normalised to our `NanoAvailability` union.
 */
export async function checkOnDeviceNanoStatus(): Promise<NanoStatus> {
  if (typeof window === 'undefined') {
    return { status: 'UNAVAILABLE', detail: 'No browser window', api: 'none' };
  }

  const w = window as PromptApiWindow;
  const api = w.LanguageModel ?? w.ai?.languageModel;

  if (!api) {
    return {
      status: 'UNAVAILABLE',
      detail: 'Chrome Prompt API not exposed (enable chrome://flags/#prompt-api-for-gemini-nano)',
      api: 'none',
    };
  }

  try {
    if (typeof api.availability === 'function') {
      const availability = await api.availability();
      switch (availability) {
        case 'available':
          return { status: 'AVAILABLE', detail: 'Gemini Nano 4 loaded and ready', api: 'prompt-api' };
        case 'downloading':
          return {
            status: 'DOWNLOADING',
            detail: 'Gemini Nano 4 is downloading — routing to cloud until it lands',
            api: 'prompt-api',
          };
        case 'downloadable':
          return {
            status: 'DOWNLOADING',
            detail: 'Gemini Nano 4 not downloaded yet — cloud fallback active',
            api: 'prompt-api',
          };
        default:
          return {
            status: 'UNAVAILABLE',
            detail: 'On-device model unavailable on this hardware',
            api: 'prompt-api',
          };
      }
    }

    if (typeof api.capabilities === 'function') {
      const capabilities = await api.capabilities();
      if (capabilities.available === 'readily') {
        return { status: 'AVAILABLE', detail: 'Gemini Nano ready', api: 'prompt-api' };
      }
      if (capabilities.available === 'after-download') {
        return {
          status: 'DOWNLOADING',
          detail: 'Gemini Nano needs a one-time download — cloud fallback active',
          api: 'prompt-api',
        };
      }
      return { status: 'UNAVAILABLE', detail: 'On-device model unsupported here', api: 'prompt-api' };
    }

    return { status: 'AVAILABLE', detail: 'Prompt API present', api: 'prompt-api' };
  } catch (error) {
    return {
      status: 'UNAVAILABLE',
      detail: error instanceof Error ? error.message : 'Capability probe failed',
      api: 'none',
    };
  }
}

export const nanoBadgeText = (status: NanoAvailability): string => {
  switch (status) {
    case 'AVAILABLE':
      return 'On-Device: Gemini Nano 4 Active';
    case 'DOWNLOADING':
      return 'Nano downloading — Cloud fallback';
    case 'CHECKING':
      return 'Probing on-device model…';
    default:
      return 'Cloud Fallback: Gemini 3.8 Flash';
  }
};

/* --------------------------------------------------------------------------
   Model handles
   -------------------------------------------------------------------------- */

interface ModelSet {
  preferOnDevice: GenerativeModel;
  onlyOnDevice: GenerativeModel;
  onlyCloud: GenerativeModel;
}

let aiClient: AI | null = null;
let modelSet: ModelSet | null = null;
let modelInitError: string | null = null;

const hybridParams = (mode: InferenceMode, temperature: number): HybridParams => ({
  mode,
  inCloudParams: {
    model: MODEL_EDGE,
    generationConfig: { temperature, responseMimeType: 'application/json', maxOutputTokens: 450 },
  },
});

const cloudParams: ModelParams = {
  model: MODEL_CLOUD,
  generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
};

export function getModelInitError(): string | null {
  return modelInitError;
}

function models(): ModelSet | null {
  if (isDemoEngine || !isFirebaseConfigured || !app) return null;
  if (modelSet) return modelSet;

  try {
    aiClient = aiClient ?? getAI(app, { backend: new GoogleAIBackend() });

    modelSet = {
      preferOnDevice: getGenerativeModel(aiClient, hybridParams(InferenceMode.PREFER_ON_DEVICE, 0.2)),
      onlyOnDevice: getGenerativeModel(aiClient, hybridParams(InferenceMode.ONLY_ON_DEVICE, 0.2)),
      onlyCloud: getGenerativeModel(aiClient, {
        mode: InferenceMode.ONLY_IN_CLOUD,
        inCloudParams: cloudParams,
      }),
    };

    return modelSet;
  } catch (error) {
    modelInitError = error instanceof Error ? error.message : 'Firebase AI failed to initialise';
    console.error('[PulseBrief] Firebase AI init failed — using the demo engine.', error);
    return null;
  }
}

export function isCloudReady(): boolean {
  return !isDemoEngine && isFirebaseConfigured;
}

/* --------------------------------------------------------------------------
   Low-level helpers
   -------------------------------------------------------------------------- */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

const jitter = (min: number, max: number): number => Math.round(min + Math.random() * (max - min));

export const estimateTokens = (text: string): number => Math.ceil(text.trim().length / 4);

export function averageLocalLatency(latencies: number[]): number {
  if (latencies.length === 0) return 0;
  return Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length);
}

export const sourceLabel = (source: InferenceSource): string => {
  switch (source) {
    case 'LOCAL_NANO':
      return 'LOCAL_NANO';
    case 'CLOUD_GEMINI':
      return 'CLOUD_GEMINI';
    case 'CLOUD_FALLBACK':
      return 'CLOUD_FALLBACK';
    default:
      return 'DEMO_ENGINE';
  }
};

export const sourceTone = (source: InferenceSource): 'local' | 'cloud' | 'redacted' => {
  if (source === 'LOCAL_NANO' || source === 'DEMO_ENGINE') return 'local';
  return 'cloud';
};

/** Parse complete, fenced, adjacent-object, or partially truncated model JSON. */
export function safeParseModelJson<T>(rawText: string, fallback: T): T {
  const cleaned = rawText.replace(/```\s*(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const candidate = cleaned.slice(start, end + 1).replace(/"\s*}\s*\{"/g, '", "');
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && fallback && typeof fallback === 'object') {
        return { ...(fallback as object), ...(parsed as object) } as T;
      }
      return parsed as T;
    } catch { /* recover useful fields from a truncated response below */ }
  }

  const recovered: Record<string, unknown> = {};
  const pairPattern = /["']?([\w]+)["']?\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|true|false|null|-?\d+(?:\.\d+)?|\[[^\]]*\])/gs;
  for (const match of cleaned.matchAll(pairPattern)) {
    const value = match[2];
    try {
      recovered[match[1]] = value.startsWith("'") ? value.slice(1, -1) : JSON.parse(value);
    } catch { /* ignore a truncated individual value */ }
  }
  if (Object.keys(recovered).length && fallback && typeof fallback === 'object') {
    return { ...(fallback as object), ...recovered } as T;
  }
  return Object.keys(recovered).length ? recovered as T : fallback;
}

function pickModel(mode: RoutingMode, nano: NanoAvailability, set: ModelSet): {
  model: GenerativeModel;
  source: InferenceSource;
} {
  if (mode === 'FORCE_LOCAL') {
    return { model: set.onlyOnDevice, source: 'LOCAL_NANO' };
  }
  if (mode === 'FORCE_CLOUD') {
    return { model: set.onlyCloud, source: 'CLOUD_GEMINI' };
  }
  if (nano === 'AVAILABLE') {
    return { model: set.preferOnDevice, source: 'LOCAL_NANO' };
  }
  return { model: set.onlyCloud, source: 'CLOUD_FALLBACK' };
}

interface CallOutcome<T> {
  data: T;
  source: InferenceSource;
  latencyMs: number;
  promptTokens: number;
}

async function runModel<T>(
  mode: RoutingMode,
  nano: NanoAvailability,
  prompt: string,
  parse: (raw: string) => T | null,
): Promise<CallOutcome<T> | null> {
  const set = models();
  if (!set) return null;

  const { model, source } = pickModel(mode, nano, set);
  const started = performance.now();

  try {
    const response = await model.generateContent(prompt);
    const text = response.response.text();
    const parsed = parse(text);
    if (parsed === null) {
      console.warn('[PulseBrief] Model response was not valid JSON — falling back locally.', text.slice(0, 240));
      return null;
    }
    return {
      data: parsed,
      source,
      latencyMs: Math.round(performance.now() - started),
      promptTokens: estimateTokens(prompt) + estimateTokens(text),
    };
  } catch (error) {
    console.warn('[PulseBrief] Model call failed — falling back to the local engine.', error);
    return null;
  }
}

/* --------------------------------------------------------------------------
   Deterministic local engine (demo mode + universal fallback)
   -------------------------------------------------------------------------- */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'your', 'their', 'about', 'what',
  'when', 'where', 'which', 'while', 'have', 'has', 'are', 'was', 'were', 'will', 'would', 'could',
  'should', 'how', 'who', 'why', 'our', 'its', 'it', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'by',
  'or', 'as', 'is', 'be', 'we', 'they', 'you', 'i',
]);

const sentencesOf = (transcript: string): string[] =>
  transcript
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 12);

/** Full speaker turns — richer evidence than one sentence cut out of a long turn. */
const turnsOf = (transcript: string): string[] =>
  transcript
    .split(/\n+/)
    .map((turn) => turn.trim())
    .filter((turn) => turn.length > 12);

const stripSpeaker = (text: string): string =>
  text.replace(/^(You \(Interviewer\)|Guest \(Prospect\)|Interviewer|Guest):\s*/i, '');

const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

function goalKeywords(goalText: string): string[] {
  const words = wordsOf(goalText).filter((word) => word.length > 3 && !STOPWORDS.has(word));
  const phrases: string[] = [];
  for (let i = 0; i < words.length - 1; i += 1) phrases.push(`${words[i]} ${words[i + 1]}`);
  return [...new Set([...words, ...phrases])];
}

function scoreSentence(sentence: string, keywords: string[]): number {
  const lower = sentence.toLowerCase();
  return keywords.reduce((score, keyword) => (lower.includes(keyword) ? score + 1 : score), 0);
}

function bestEvidence(transcript: string, keywords: string[]): { sentence: string; hits: number } {
  let best = { sentence: '', hits: 0, rank: -1 };
  for (const turn of turnsOf(transcript)) {
    const hits = scoreSentence(turn, keywords);
    if (hits === 0) continue;
    // Tie-break toward the guest's turns and lines with hard numbers: the best
    // evidence for a goal is almost never the interviewer's question.
    const rank = hits * 10 + (/\d/.test(turn) ? 2 : 0) + (/^Guest/i.test(turn) ? 1 : 0);
    if (rank > best.rank) best = { sentence: turn, hits, rank };
  }
  return { sentence: best.sentence, hits: best.hits };
}

function clip(text: string, max = 180): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

const HEDGE_PATTERNS = [
  'kind of', 'sort of', 'probably', 'maybe', 'i think', 'not sure', 'around', 'roughly',
  'weird', 'honestly', 'it depends', 'mostly', 'somewhat', 'i guess', 'or so', 'we try',
  'pretty much', 'a bit',
];

interface NudgeDraft {
  shouldNudge: boolean;
  triggerType?: 'VAGUE_ANSWER' | 'UNANSWERED_QUESTION' | 'FOLLOW_UP_OPPORTUNITY';
  detectedContext?: string;
  suggestedQuestion?: string;
}

function localEvaluateGoals(
  transcript: string,
  goals: SessionGoal[],
  latencyMs: number,
): InferenceResult<{ updates: Array<Pick<SessionGoal, 'id' | 'status' | 'evidenceSnippet'>> }> {
  const updates: Array<Pick<SessionGoal, 'id' | 'status' | 'evidenceSnippet'>> = [];

  for (const goal of goals) {
    if (goal.status === 'covered') continue;
    const keywords = goal.keywords?.length ? goal.keywords : goalKeywords(goal.text);
    const evidence = bestEvidence(transcript, keywords);
    if (evidence.hits === 0) continue;

    const hasNumbers = /\d/.test(evidence.sentence);
    let status: SessionGoal['status'] = 'pending';
    if (evidence.hits >= 3 || (evidence.hits >= 2 && hasNumbers)) status = 'covered';
    else if (evidence.hits >= 2 || hasNumbers) status = 'partial';

    if (status === 'pending') continue;
    if (status === goal.status) continue;

    updates.push({ id: goal.id, status, evidenceSnippet: clip(stripSpeaker(evidence.sentence), 180) });
  }

  return {
    data: { updates },
    meta: { source: 'DEMO_ENGINE', latencyMs, tokens: 0 },
  };
}

function localNudge(
  transcript: string,
  goals: SessionGoal[],
  latencyMs: number,
  turnCount: number,
): InferenceResult<NudgeDraft> {
  const sentences = sentencesOf(transcript);
  const lastGuest = [...sentences].reverse().find((sentence) => !sentence.endsWith('?')) ?? '';
  const lower = lastGuest.toLowerCase();
  const hedge = HEDGE_PATTERNS.find((pattern) => lower.includes(pattern));
  const hasNumber = /\d/.test(lastGuest);

  const empty: NudgeDraft = { shouldNudge: false };
  const meta = {
    source: 'DEMO_ENGINE' as const,
    latencyMs,
    tokens: 0,
  };

  // Only surface a nudge every other turn — a co-pilot that interrupts
  // constantly is worse than one that stays quiet.
  if (turnCount % 2 === 0) {
    return { data: empty, meta };
  }

  if (hedge && !hasNumber) {
    const topic = lower.includes('budget') || lower.includes('cost')
      ? 'budget'
      : lower.includes('spreadsheet') || lower.includes('manual') || lower.includes('hand')
        ? 'process'
        : lower.includes('netsuite') || lower.includes('it') || lower.includes('system')
          ? 'systems'
          : 'general';

    const questions: Record<string, string> = {
      budget:
        'You mentioned budget pressure — what number would have to be true for this to get funded this quarter, and who signs it off?',
      process:
        'Walk me through the last one that slipped through by hand — who touched it, and where exactly did it stall?',
      systems:
        'If IT has to be involved, who owns the technical sign-off, and what is their biggest objection likely to be?',
      general:
        'Can you put a number on that? What does it cost you in hours or dollars in a typical month?',
    };

    return {
      data: {
        shouldNudge: true,
        triggerType: 'VAGUE_ANSWER',
        detectedContext: clip(lastGuest, 150),
        suggestedQuestion: questions[topic],
      },
      meta,
    };
  }

  const shallowGoal = goals.find(
    (goal) => goal.status !== 'covered' && scoreSentence(lastGuest, goalKeywords(goal.text)) >= 2,
  );

  if (shallowGoal) {
    return {
      data: {
        shouldNudge: true,
        triggerType: 'FOLLOW_UP_OPPORTUNITY',
        detectedContext: clip(lastGuest, 150),
        suggestedQuestion: `You're close on “${clip(shallowGoal.text, 62)}” — ask for the specific example: what happened last time, and what did it cost?`,
      },
      meta,
    };
  }

  return { data: empty, meta };
}

/** Deterministic PII masking — the safety net that must never miss. */
const PII_RULES: Array<{
  label: string;
  pattern: RegExp;
  replacement: string;
  validate?: (match: string) => boolean;
}> = [
  {
    label: 'EMAIL',
    pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    replacement: '[REDACTED_EMAIL]',
  },
  {
    label: 'SSN',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[REDACTED_ID]',
  },
  {
    label: 'ACCOUNT_ID',
    pattern: /\b(?:ACCT|ACC|PO|INV|SAP|CUST|EMP)[-_ ]?\d{4,}\b/gi,
    replacement: '[REDACTED_ID]',
  },
  {
    label: 'ADDRESS',
    pattern:
      /\b\d{2,5}\s+(?:[A-Z][A-Za-z'-]+\s){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Parkway|Pkwy|Lane|Ln|Way|Court|Ct|Place|Pl)\.?/g,
    replacement: '[REDACTED_ADDRESS]',
  },
  {
    label: 'PHONE',
    pattern: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\d{2,4}[\s.-])\d{3}[\s.-]\d{4}\b/g,
    replacement: '[REDACTED_PHONE]',
    validate: (match) => {
      const digits = match.replace(/\D/g, '');
      return digits.length >= 9 && digits.length <= 15;
    },
  },
  {
    label: 'PHONE',
    pattern: /\+\d{1,3}\s?\d{2,4}\s?\d{3}\s?\d{3,4}\b/g,
    replacement: '[REDACTED_PHONE]',
    validate: (match) => match.replace(/\D/g, '').length >= 9,
  },
];

export interface RedactionOutcome {
  sanitizedTranscript: string;
  redactionCount: number;
  entities: string[];
}

export function applyDeterministicRedaction(transcript: string): RedactionOutcome {
  let output = transcript;
  const entities: string[] = [];

  for (const rule of PII_RULES) {
    output = output.replace(rule.pattern, (match) => {
      if (rule.validate && !rule.validate(match)) return match;
      entities.push(rule.label);
      return rule.replacement;
    });
  }

  return {
    sanitizedTranscript: output,
    redactionCount: entities.length,
    entities,
  };
}

function localRedact(transcript: string, latencyMs: number): InferenceResult<RedactionOutcome> {
  const regexPass = applyDeterministicRedaction(transcript);
  return {
    data: regexPass,
    meta: {
      source: 'DEMO_ENGINE',
      latencyMs,
      tokens: 0,
    },
  };
}

/* --------------------------------------------------------------------------
   Post-call synthesis (local fallback keeps the demo convincing offline)
   -------------------------------------------------------------------------- */

interface BriefContext {
  company?: string;
  contact?: string;
  role?: string;
  rawTranscript?: string;
  redactionCount?: number;
}

function tidy(sentence: string): string {
  let cleaned = sentence.replace(/^[\s\-–—]+/, '').trim();
  // Drop conversational filler so a quote can stand alone in a brief.
  cleaned = cleaned.replace(
    /^(sure|yeah|yes|okay|ok|right|absolutely|well|so|honestly|look|i mean|kind of)[,.]\s+/i,
    '',
  );
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function findSentence(transcript: string, terms: string[], fallback: string): string {
  let best = { turn: '', rank: 0 };
  for (const turn of turnsOf(transcript)) {
    const clean = stripSpeaker(turn);
    const lower = clean.toLowerCase();
    const hits = terms.reduce((total, term) => (lower.includes(term) ? total + 1 : total), 0);
    if (hits === 0) continue;
    // Guest turns with hard numbers beat the interviewer's prompts, and a
    // question is rarely the answer we want to quote in a brief.
    const rank =
      hits * 10 +
      (/\d/.test(clean) ? 3 : 0) +
      (/^Guest/i.test(turn) ? 3 : 0) -
      (clean.endsWith('?') ? 12 : 0);
    if (rank > best.rank) best = { turn: clean, rank };
  }

  if (best.rank <= 0) return fallback;

  let chosen = best.turn;
  if (chosen.length > 200) {
    let match = { text: '', hits: 0 };
    for (const sentence of sentencesOf(chosen)) {
      const hits = terms.reduce(
        (total, term) => (sentence.toLowerCase().includes(term) ? total + 1 : total),
        0,
      );
      if (hits > match.hits) match = { text: sentence, hits };
    }
    if (match.hits >= 2) chosen = match.text;
  }

  return clip(tidy(chosen), 240);
}

function buildLocalBrief(
  sanitizedTranscript: string,
  goals: SessionGoal[],
  telemetry: InferenceTelemetry,
  context: BriefContext,
  latencyMs: number,
): PostCallBrief {
  const company = context.company ?? 'This account';
  const contact = context.contact ?? 'the team';
  const firstName = contact.split(' ')[0] ?? contact;

  const scale = findSentence(
    sanitizedTranscript,
    ['invoices', 'volume', 'per month', 'warehouses', 'monthly'],
    'The team did not quantify volume on this call — confirm the monthly transaction count in the follow-up.',
  );
  const pain = findSentence(
    sanitizedTranscript,
    ['duplicate', 'write off', 'error', 'reconcil', 'manual', 'slipped', 'break'],
    'The core pain was not stated explicitly — probe for the single most expensive failure mode.',
  );
  const cost = findSentence(
    sanitizedTranscript,
    ['week', 'close', 'cost', 'hours', 'days', 'refund'],
    'Cost impact needs a concrete number — ask for annualized spend or hours per month.',
  );
  const decision = findSentence(
    sanitizedTranscript,
    ['budget', 'capex', 'approve', 'finance', 'marcus', 'procurement', '75k'],
    'Budget authority is unconfirmed — identify the economic buyer before proposing a pilot.',
  );
  const nextStep = findSentence(
    sanitizedTranscript,
    ['thursday', 'next step', 'questionnaire', 'scoping', 'invite', 'pilot', 'send'],
    'No next step was locked — propose a specific 30-minute working session with two dates.',
  );

  const currentStack = findSentence(
    sanitizedTranscript,
    ['netsuite', 'excel', 'docuware', 'stack', 'spreadsheet', 'sap', 'salesforce', 'hubspot', 'jira'],
    'Current stack not enumerated — map the system of record and the spreadsheet layer next call.',
  );

  const executiveSummary = [
    `Scale: ${scale}`,
    `Cost of the status quo: ${cost}`,
    `Where it breaks: ${pain}`,
    `Decision path: ${decision}`,
    `Next step: ${nextStep}`,
  ].map((line) => clip(line, 220));

  const crmFields: CrmFields = {
    painPoint: pain,
    currentStack,
    budgetAuthority: decision,
    timeline: findSentence(
      sanitizedTranscript,
      ['january', 'quarter', 'q1', 'timeline', 'thursday', 'february', 'cycle'],
      'Timeline not confirmed — anchor it to the next fiscal milestone in the follow-up.',
    ),
    nextStep,
  };

  const goalBlock = goals
    .map((goal) => `• ${goal.text} — ${goal.status.toUpperCase()}${goal.evidenceSnippet ? `: “${goal.evidenceSnippet}”` : ''}`)
    .join('\n');

  const followUpEmailDraft = [
    `Subject: Next step on duplicate invoice detection — ${company}`,
    '',
    `Hi ${firstName},`,
    '',
    `Thanks for walking me through how invoices move through ${company} today. Recapping what I heard so we are aligned:`,
    '',
    `• Volume and workflow: ${scale}`,
    `• Current cost: ${cost}`,
    `• Where it breaks: ${pain}`,
    `• Stack: ${currentStack}`,
    '',
    `You mentioned wanting proof that duplicates are caught before payment, without turning this into a long IT project — that is exactly the scope I would bring to the working session.`,
    '',
    `Proposed next step: ${nextStep}`,
    '',
    'I have also attached our security overview and SOC 2 summary so your IT lead has it ahead of time. If Thursday no longer works, send me two windows that do and I will work around them.',
    '',
    `Best,`,
    `[Your name]`,
    '',
    '— — —',
    'Session goals tracked on-device:',
    goalBlock,
  ].join('\n');

  return {
    title: `${company} — ${context.role ?? 'Discovery'} brief`,
    createdAt: new Date().toISOString(),
    sanitizedTranscript,
    rawTranscript: context.rawTranscript ?? sanitizedTranscript,
    redactionCount: context.redactionCount ?? 0,
    executiveSummary,
    goalOutcomes: goals,
    crmFields,
    followUpEmailDraft,
    telemetry,
    syncStatus: 'SAVING',
    engine: isDemoEngine ? 'DEMO_ENGINE' : 'CLOUD_GEMINI',
    company,
    contact,
    cloudLatencyMs: latencyMs,
  };
}

/* --------------------------------------------------------------------------
   Op 1 — live goal tracking
   -------------------------------------------------------------------------- */

export interface GoalUpdatePayload {
  updates: Array<Pick<SessionGoal, 'id' | 'status' | 'evidenceSnippet'>>;
}

export async function evaluateLiveGoals(
  recentTranscript: string,
  goals: SessionGoal[],
  routingMode: RoutingMode,
  nanoStatus: NanoAvailability = 'AVAILABLE',
): Promise<InferenceResult<GoalUpdatePayload>> {
  if (goals.length === 0) {
    return { data: { updates: [] }, meta: { source: 'LOCAL_NANO', latencyMs: 0, tokens: 0 } };
  }
  const pending = goals.filter((goal) => goal.status !== 'covered');
  if (!pending.length || !recentTranscript.trim()) {
    return {
      data: { updates: [] },
      meta: { source: 'LOCAL_NANO', latencyMs: 0, tokens: 0 },
    };
  }

  const prompt = [
    'You are PulseBrief, an on-device meeting co-pilot running Gemini Nano.',
    'You receive a rolling transcript window and a list of session goals.',
    'For every goal that the transcript now evidences, return an updated status.',
    'Rules:',
    '- "covered" only when the transcript contains concrete evidence (a number, named owner, or explicit commitment).',
    '- "partial" when the topic was addressed but details are missing.',
    '- Never downgrade a goal that is already covered.',
    '- evidenceSnippet must be a verbatim quote, <= 25 words.',
    'Respond with ONE raw JSON object only. Do NOT use markdown code blocks. Keep values under 18 words.',
    'Return exactly this shape:',
    '{"updates":[{"id":"goal-1","status":"covered","evidenceSnippet":"..."}]}',
    '',
    `GOALS:\n${pending.map((goal) => `- ${goal.id}: ${goal.text} (current: ${goal.status})`).join('\n')}`,
    '',
    `TRANSCRIPT:\n${recentTranscript.slice(-6000)}`,
  ].join('\n');

  const remote = await runModel<GoalUpdatePayload>(routingMode, nanoStatus, prompt, (raw) => {
    const parsed = safeParseModelJson<GoalUpdatePayload>(raw, { updates: [] });
    if (!parsed || !Array.isArray(parsed.updates)) return null;
    const updates = parsed.updates
      .filter((update) => typeof update?.id === 'string')
      .map((update) => ({
        id: update.id,
        status: (['pending', 'partial', 'covered'] as const).includes(update.status)
          ? update.status
          : 'partial',
        evidenceSnippet: typeof update.evidenceSnippet === 'string' ? update.evidenceSnippet : undefined,
      }));
    return { updates };
  });

  if (remote) {
    return {
      data: remote.data,
      meta: {
        source: remote.source,
        latencyMs: remote.latencyMs,
        tokens: remote.promptTokens,
        fallbackReason: remote.source === 'CLOUD_FALLBACK' ? 'On-device model unavailable' : undefined,
      },
    };
  }

  const simulatedLatency = jitter(160, 340);
  await sleep(simulatedLatency);
  return localEvaluateGoals(recentTranscript, goals, simulatedLatency);
}

/* --------------------------------------------------------------------------
   Op 2 — live follow-up nudge
   -------------------------------------------------------------------------- */

export async function generateLiveFollowUpNudge(
  recentTranscript: string,
  goals: SessionGoal[],
  routingMode: RoutingMode,
  nanoStatus: NanoAvailability = 'AVAILABLE',
  turnCount = 1,
): Promise<InferenceResult<NudgeDraft>> {
  if (!recentTranscript.trim()) {
    return {
      data: { shouldNudge: false },
      meta: { source: 'LOCAL_NANO', latencyMs: 0, tokens: 0 },
    };
  }

  const prompt = [
    'You are PulseBrief, an on-device real-time sales/interview co-pilot.',
    'Read the last few transcript turns and decide whether the interviewer should ask ONE sharper follow-up right now.',
    'Nudge when: (a) the guest gave a hedged or vague answer without numbers, (b) an important question was left shallow, or (c) a session goal was touched but not evidenced.',
    'Do NOT nudge when the answer was concrete, or when the last turn was the interviewer speaking.',
    'The suggested question must be specific, under 30 words, and reference what the guest just said.',
    'Respond with ONE raw JSON object only. Do NOT use markdown code blocks. Keep values under 18 words.',
    '{"shouldNudge":true,"triggerType":"VAGUE_ANSWER|UNANSWERED_QUESTION|FOLLOW_UP_OPPORTUNITY","detectedContext":"<=25 word quote of the vague answer","suggestedQuestion":"..."}',
    '',
    `OPEN GOALS:\n${goals.filter((goal) => goal.status !== 'covered').map((goal) => `- ${goal.text}`).join('\n') || '- none'}`,
    '',
    `TRANSCRIPT:\n${recentTranscript.slice(-2500)}`,
  ].join('\n');

  const remote = await runModel<NudgeDraft>(routingMode, nanoStatus, prompt, (raw) => {
    const parsed = safeParseModelJson<NudgeDraft>(raw, { shouldNudge: false });
    if (!parsed || typeof parsed.shouldNudge !== 'boolean') return null;
    const allowed = ['VAGUE_ANSWER', 'UNANSWERED_QUESTION', 'FOLLOW_UP_OPPORTUNITY'] as const;
    return {
      shouldNudge: parsed.shouldNudge,
      triggerType: allowed.includes(parsed.triggerType as (typeof allowed)[number])
        ? parsed.triggerType
        : 'FOLLOW_UP_OPPORTUNITY',
      detectedContext: typeof parsed.detectedContext === 'string' ? parsed.detectedContext : '',
      suggestedQuestion: typeof parsed.suggestedQuestion === 'string' ? parsed.suggestedQuestion : '',
    };
  });

  if (remote && (!remote.data.shouldNudge || remote.data.suggestedQuestion)) {
    return {
      data: remote.data,
      meta: {
        source: remote.source,
        latencyMs: remote.latencyMs,
        tokens: remote.promptTokens,
        fallbackReason: remote.source === 'CLOUD_FALLBACK' ? 'On-device model unavailable' : undefined,
      },
    };
  }

  const simulatedLatency = jitter(180, 420);
  await sleep(simulatedLatency);
  return localNudge(recentTranscript, goals, simulatedLatency, turnCount);
}

/* --------------------------------------------------------------------------
   Op 3 — local PII redaction (privacy gate)
   -------------------------------------------------------------------------- */

export async function redactPiiLocally(
  fullTranscript: string,
  routingMode: RoutingMode,
  nanoStatus: NanoAvailability = 'AVAILABLE',
): Promise<InferenceResult<RedactionOutcome>> {
  const prompt = [
    'You are the privacy gate inside PulseBrief, running entirely on-device with Gemini Nano.',
    'Mask every personal or account-identifying entity in the transcript:',
    '- personal email addresses -> [REDACTED_EMAIL]',
    '- phone numbers -> [REDACTED_PHONE]',
    '- street addresses -> [REDACTED_ADDRESS]',
    '- account numbers, customer IDs, policy numbers, employee IDs -> [REDACTED_ID]',
    'Preserve every other word, including punctuation and speaker labels. Never summarise.',
    'Respond with JSON only: {"sanitizedTranscript":"...","entities":["EMAIL","PHONE"]}',
    '',
    `TRANSCRIPT:\n${fullTranscript}`,
  ].join('\n');

  const remote = await runModel<RedactionOutcome>(routingMode, nanoStatus, prompt, (raw) => {
    const parsed = safeParseModelJson<{ sanitizedTranscript?: string; entities?: string[] }>(raw, {});
    if (!parsed || typeof parsed.sanitizedTranscript !== 'string') return null;
    // Guard against a truncated or summarised rewrite: the sanitized text must
    // stay comparable in length to the source, or we discard it.
    if (parsed.sanitizedTranscript.length < fullTranscript.length * 0.6) return null;
    return { sanitizedTranscript: parsed.sanitizedTranscript, redactionCount: 0, entities: parsed.entities ?? [] };
  });

  const simulatedLatency = remote ? 0 : jitter(200, 460);
  if (!remote) await sleep(simulatedLatency);

  // The regex pass ALWAYS runs — even on a model response. Belt and braces:
  // a conservative Nano must never be the reason an email reaches the cloud.
  const base = remote?.data.sanitizedTranscript ?? fullTranscript;
  const safetyPass = applyDeterministicRedaction(base);
  const source: InferenceSource = remote ? remote.source : 'DEMO_ENGINE';

  return {
    data: safetyPass,
    meta: {
      source,
      latencyMs: remote ? remote.latencyMs : simulatedLatency,
      tokens: remote?.promptTokens ?? 0,
      // A model pass that found nothing still costs a call; the regex pass is free.
    },
  };
}

/* --------------------------------------------------------------------------
   Op 4 — post-call synthesis (cloud only, sanitized input)
   -------------------------------------------------------------------------- */

export async function synthesizePostCallBrief(
  sanitizedTranscript: string,
  goals: SessionGoal[],
  telemetry: InferenceTelemetry,
  context: BriefContext = {},
): Promise<InferenceResult<PostCallBrief>> {
  const company = context.company ?? 'This account';
  const contact = context.contact ?? 'the team';

  const prompt = [
    `You are a senior revenue analyst writing a post-call brief for ${company}.`,
    'The transcript has already been sanitized on-device: [REDACTED_*] placeholders are privacy markers, not missing data.',
    'Write for a busy account executive. Be specific, quote numbers from the transcript, never invent facts.',
    'Respond with JSON only:',
    '{',
    '  "title": "<=90 chars",',
    '  "executiveSummary": ["5 bullets, each <=28 words, specific and non-overlapping"],',
    '  "crmFields": {',
    '    "painPoint": "...", "currentStack": "...", "budgetAuthority": "...", "timeline": "...", "nextStep": "..."',
    '  },',
    '  "followUpEmailDraft": "full email with Subject line, greeting, 3 short paragraphs or bullets, and a clear ask"',
    '}',
    '',
    `GOAL OUTCOMES:\n${goals.length
      ? goals.map((goal) => `- ${goal.text} => ${goal.status}${goal.evidenceSnippet ? ` ("${goal.evidenceSnippet}")` : ''}`).join('\n')
      : '- Open call with no preset goals. Derive the brief, CRM fields, and email solely from transcript evidence.'}`,
    '',
    `SANITIZED TRANSCRIPT:\n${sanitizedTranscript}`,
  ].join('\n');

  const remote = await runModel<{
    title?: string;
    executiveSummary?: string[];
    crmFields?: Partial<CrmFields>;
    followUpEmailDraft?: string;
  }>('FORCE_CLOUD', 'AVAILABLE', prompt, (raw) => {
    const parsed = safeParseModelJson<{
      title?: string;
      executiveSummary?: string[];
      crmFields?: Partial<CrmFields>;
      followUpEmailDraft?: string;
    }>(raw, {});
    if (!parsed || !Array.isArray(parsed.executiveSummary) || parsed.executiveSummary.length < 3) return null;
    return parsed;
  });

  if (remote) {
    const fallback = buildLocalBrief(sanitizedTranscript, goals, telemetry, context, remote.latencyMs);
    const crmFields: CrmFields = {
      painPoint: remote.data.crmFields?.painPoint || fallback.crmFields.painPoint,
      currentStack: remote.data.crmFields?.currentStack || fallback.crmFields.currentStack,
      budgetAuthority: remote.data.crmFields?.budgetAuthority || fallback.crmFields.budgetAuthority,
      timeline: remote.data.crmFields?.timeline || fallback.crmFields.timeline,
      nextStep: remote.data.crmFields?.nextStep || fallback.crmFields.nextStep,
    };

    return {
      data: {
        ...fallback,
        title: remote.data.title || fallback.title,
        executiveSummary: (remote.data.executiveSummary ?? fallback.executiveSummary)
          .slice(0, 5)
          .map((line) => clip(line, 240)),
        crmFields,
        followUpEmailDraft: remote.data.followUpEmailDraft || fallback.followUpEmailDraft,
        engine: 'CLOUD_GEMINI',
        cloudLatencyMs: remote.latencyMs,
      },
      meta: { source: 'CLOUD_GEMINI', latencyMs: remote.latencyMs, tokens: remote.promptTokens },
    };
  }

  // Cloud unreachable (or demo mode): a cloud-shaped synthesis runs against the
  // sanitized text locally so the workflow still completes end-to-end.
  const simulatedLatency = CAPTURE_MODE ? 200 : jitter(900, 1400);
  await sleep(simulatedLatency);
  const brief = buildLocalBrief(sanitizedTranscript, goals, telemetry, context, simulatedLatency);

  return {
    data: { ...brief, engine: isDemoEngine ? 'DEMO_ENGINE' : 'CLOUD_FALLBACK' },
    meta: {
      source: isDemoEngine ? 'DEMO_ENGINE' : 'CLOUD_FALLBACK',
      latencyMs: simulatedLatency,
      tokens: estimateTokens(sanitizedTranscript),
      fallbackReason: isDemoEngine
        ? 'No Firebase project configured — local synthesis engine'
        : 'Cloud Gemini unavailable — local synthesis engine',
    },
  };
}

/* --------------------------------------------------------------------------
   Telemetry helpers
   -------------------------------------------------------------------------- */

export function createEmptyTelemetry(): InferenceTelemetry {
  return {
    localNanoCalls: 0,
    cloudGeminiCalls: 0,
    piiEntitiesRedactedLocally: 0,
    localLatenciesMs: [],
    cloudLatencyMs: null,
    estimatedTokensSavedLocally: 0,
  };
}

export function mergeTelemetry(
  telemetry: InferenceTelemetry,
  result: InferenceResult<unknown>,
  operation: 'local' | 'cloud',
  inputText: string,
): InferenceTelemetry {
  if (result.meta.latencyMs === 0) return telemetry;
  // A backup answer in a real Firebase session is not an AI call, so it is not counted.
  if (result.meta.source === 'DEMO_ENGINE' && !isDemoEngine) return telemetry;

  if (operation === 'local') {
    return {
      ...telemetry,
      localNanoCalls: telemetry.localNanoCalls + 1,
      localLatenciesMs: [...telemetry.localLatenciesMs, result.meta.latencyMs],
      estimatedTokensSavedLocally: telemetry.estimatedTokensSavedLocally + estimateTokens(inputText),
    };
  }

  return {
    ...telemetry,
    cloudGeminiCalls: telemetry.cloudGeminiCalls + 1,
    cloudLatencyMs: result.meta.latencyMs,
  };
}

export function nudgeFromDraft(
  draft: NudgeDraft,
  meta: InferenceResult<NudgeDraft>['meta'],
): CoPilotNudge | null {
  if (!draft.shouldNudge || !draft.suggestedQuestion) return null;
  return {
    id: `nudge_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    triggerType: draft.triggerType ?? 'FOLLOW_UP_OPPORTUNITY',
    detectedContext: draft.detectedContext ?? '',
    suggestedQuestion: draft.suggestedQuestion,
    source: meta.source,
    latencyMs: meta.latencyMs,
  };
}
