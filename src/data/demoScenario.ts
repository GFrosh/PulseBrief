import type { Scenario } from '../types/session';

/**
 * Judge-friendly demo content.
 *
 * Two fully-scripted conversations (plus a blank custom template) that stream
 * into the live transcript exactly like speech recognition would — including
 * hedged answers that should trigger on-device follow-up nudges, and realistic
 * PII that must be masked locally before the cloud synthesis step.
 *
 * The `keywords` arrays are only used by the deterministic demo engine. When a
 * real Firebase project is configured, Gemini does its own semantic matching.
 */

export const LOGISTICS_DISCOVERY: Scenario = {
  id: 'LOGISTICS_DISCOVERY',
  label: 'Customer Discovery: Logistics Ops',
  shortLabel: 'Logistics Ops',
  company: 'Northline Logistics',
  contact: 'Dana Reyes',
  role: 'Director of Operations',
  goals: [
    {
      id: 'goal-1',
      text: 'Map the invoice intake → approval workflow (volume, tools, handoffs)',
      keywords: ['invoice', 'inbox', 'netsuite', 'workflow', 'hand', 'warehouse', 'approve', 'key'],
    },
    {
      id: 'goal-2',
      text: 'Quantify the cost of manual reconciliation errors',
      keywords: ['duplicate', 'error', 'cost', 'close', 'write off', 'reconcil', 'payment', 'slipped'],
    },
    {
      id: 'goal-3',
      text: 'Identify budget authority and the procurement path',
      keywords: ['budget', 'approve', 'finance', 'capex', 'marcus', 'procurement', 'ceiling'],
    },
    {
      id: 'goal-4',
      text: 'Agree a concrete next step and pilot timeline',
      keywords: ['pilot', 'january', 'february', 'thursday', 'next step', 'security questionnaire', 'scoping', 'demo', 'invite', 'send'],
    },
  ],
  lines: [
    {
      speaker: 'You (Interviewer)',
      gapMs: 900,
      text: "Thanks for making the time, Dana. Before we dive in — walk me through how a carrier invoice moves through Northline today, from the moment it lands.",
    },
    {
      speaker: 'Guest (Prospect)',
      gapMs: 1500,
      text: "Sure. They mostly hit our AP inbox — ap@northline-logistics.com — and my team keys them into NetSuite by hand. About 14,000 invoices a month across three warehouses.",
    },
    {
      speaker: 'You (Interviewer)',
      gapMs: 1100,
      text: "Fourteen thousand a month. How many people touch that every day?",
    },
    {
      speaker: 'Guest (Prospect)',
      gapMs: 1400,
      text: "Six on the ops side, plus two in finance who approve anything over ten grand. It's kind of a relay race, honestly.",
    },
    {
      speaker: 'You (Interviewer)',
      gapMs: 1000,
      text: "Where does the relay break most often?",
    },
    {
      speaker: 'Guest (Prospect)',
      gapMs: 1600,
      text: "Duplicate payments, mostly. Same carrier bills twice with a slightly different PO format and nobody catches it. We wrote off about $120K last year.",
    },
    {
      speaker: 'You (Interviewer)',
      gapMs: 1200,
      text: "That's a real number. What happens internally when one slips through?",
    },
    {
      speaker: 'Guest (Prospect)',
      gapMs: 1800,
      text: "Finance finds it at month-end close, then we spend about a week untangling it. Close slipped four to nine days every month last quarter.",
    },
    {
      speaker: 'You (Interviewer)',
      gapMs: 1000,
      text: "What does that week actually cost you, beyond the refund?",
    },
    {
      speaker: 'Guest (Prospect)',
      gapMs: 1500,
      text: "Honestly? Credibility with the CFO. Budgets are weird right now, so every miss gets noticed.",
    },
    {
      speaker: 'You (Interviewer)',
      gapMs: 1100,
      text: "Let's stay on that. If you found a fix, whose budget does it come out of?",
    },
    {
      speaker: 'Guest (Prospect)',
      gapMs: 1900,
      text: "Mine, up to about $75K a year. Anything above that goes to Marcus Feld, our VP Finance — and he only reviews capex in the Q1 cycle.",
    },
    {
      speaker: 'You (Interviewer)',
      gapMs: 1200,
      text: "So a January decision maps to a February pilot. What would you need to see to actually sign?",
    },
    {
      speaker: 'Guest (Prospect)',
      gapMs: 1700,
      text: "Proof it catches duplicates before payment, not after. And that it doesn't become a six-month IT project — Priya in IT owns anything touching NetSuite.",
    },
    {
      speaker: 'You (Interviewer)',
      gapMs: 1000,
      text: "Is the NetSuite integration a hard requirement, or would a sidecar that reads the inbox work?",
    },
    {
      speaker: 'Guest (Prospect)',
      gapMs: 1500,
      text: "A sidecar would honestly be fine to start. We are not ripping out NetSuite.",
    },
    {
      speaker: 'You (Interviewer)',
      gapMs: 1100,
      text: "Good to know. What's the rest of the stack beyond NetSuite and Excel?",
    },
    {
      speaker: 'Guest (Prospect)',
      gapMs: 2000,
      text: "DocuWare for archive, and yes, a truly cursed shared spreadsheet. My direct line is +1 (415) 555-0132, and the HQ is 1840 Harbor Bay Parkway, Alameda.",
    },
    {
      speaker: 'You (Interviewer)',
      gapMs: 1000,
      text: "Perfect. Can I send the security questionnaire over before Thursday?",
    },
    {
      speaker: 'Guest (Prospect)',
      gapMs: 1600,
      text: "Send it to dana.reyes@northline-logistics.com and cc Priya — she'll want the SOC 2. Our carrier portal account ID is ACCT-88213 if that helps your sandbox.",
    },
    {
      speaker: 'You (Interviewer)',
      gapMs: 1300,
      text: "That helps a lot. I'll book thirty minutes with Priya on Thursday and bring a duplicate-detection demo on your sample invoices.",
    },
    {
      speaker: 'Guest (Prospect)',
      gapMs: 1400,
      text: "Works for me. Thursday after 2pm is wide open — send the invite and I'll forward it to her.",
    },
  ],
};

export const TECH_SCREEN: Scenario = {
  id: 'TECH_SCREEN',
  label: 'Technical Candidate Screen',
  shortLabel: 'Tech Screen',
  company: 'PulseBrief Talent',
  contact: 'Ayo Banjo',
  role: 'Senior Platform Engineer candidate',
  goals: [
    {
      id: 'goal-1',
      text: 'Probe distributed-systems trade-offs (consistency vs. latency)',
      keywords: ['consistency', 'latency', 'replica', 'partition', 'queue', 'eventual', 'tradeoff', 'quorum', 'staleness', 'ledger'],
    },
    {
      id: 'goal-2',
      text: 'Evaluate incident ownership and debugging depth',
      keywords: ['incident', 'on-call', 'debug', 'root cause', 'rollback', 'postmortem', 'outage', 'blameless'],
    },
    {
      id: 'goal-3',
      text: 'Assess collaboration with product and design partners',
      keywords: ['product', 'design', 'collaborat', 'stakeholder', 'review', 'team', 'disagree', 'cost estimate'],
    },
    {
      id: 'goal-4',
      text: 'Confirm availability, level, and compensation expectations',
      keywords: ['notice', 'availability', 'comp', 'salary', 'level', 'start date', 'offer'],
    },
  ],
  lines: [
    {
      speaker: 'You (Interviewer)',
      gapMs: 900,
      text: "Let's start concrete. Tell me about the last system where you had to pick between strong consistency and p99 latency.",
    },
    {
      speaker: 'Guest (Prospect)',
      gapMs: 1800,
      text: "Our ledger service. We had a quorum write path in Postgres and the checkout team wanted sub-50ms reads, so we added a read replica with a bounded staleness window of about 400ms.",
    },
    {
      speaker: 'You (Interviewer)',
      gapMs: 1000,
      text: "What broke first when traffic doubled?",
    },
    {
      speaker: 'Guest (Prospect)',
      gapMs: 1700,
      text: "Replication lag. It was probably a network thing, we never fully pinned it down. We mostly threw more read replicas at it.",
    },
    {
      speaker: 'You (Interviewer)',
      gapMs: 1200,
      text: "You never pinned it down — walk me through what you did investigate.",
    },
    {
      speaker: 'Guest (Prospect)',
      gapMs: 2000,
      text: "We pulled pg_stat_replication, saw the lag spike on one AZ, and moved the replica. The postmortem was thin, honestly — we shipped the mitigation before the root cause.",
    },
    {
      speaker: 'You (Interviewer)',
      gapMs: 1000,
      text: "Who owned that incident channel?",
    },
    {
      speaker: 'Guest (Prospect)',
      gapMs: 1500,
      text: "I was on-call. I ran the incident, looped in the product lead, and wrote the follow-up. We do blameless reviews every Friday.",
    },
    {
      speaker: 'You (Interviewer)',
      gapMs: 1100,
      text: "How do you handle disagreement with a product partner on a technical constraint?",
    },
    {
      speaker: 'Guest (Prospect)',
      gapMs: 1600,
      text: "I try to bring a cost estimate rather than an opinion. Sometimes it works. It depends on the stakeholder.",
    },
    {
      speaker: 'You (Interviewer)',
      gapMs: 1200,
      text: "Give me an example where it didn't work.",
    },
    {
      speaker: 'Guest (Prospect)',
      gapMs: 1900,
      text: "We shipped a feature without the backfill I asked for, and I spent two weekends cleaning it up. I documented it, but nothing structural changed.",
    },
    {
      speaker: 'You (Interviewer)',
      gapMs: 1000,
      text: "Fair. Where are you in your search, and what's your notice period?",
    },
    {
      speaker: 'Guest (Prospect)',
      gapMs: 1500,
      text: "I'm interviewing with three companies, roughly the same stage. Notice is four weeks, and I'm targeting the senior band — around 190 to 210 base.",
    },
    {
      speaker: 'You (Interviewer)',
      gapMs: 1100,
      text: "Any hard constraints on start date or location?",
    },
    {
      speaker: 'Guest (Prospect)',
      gapMs: 1400,
      text: "I'd need to start by mid-February, and I'm in Lagos — happy to overlap four hours with your team. You can reach me at ayo.banjo@example.dev.",
    },
  ],
};

export const CUSTOM_SCENARIO: Scenario = {
  id: 'CUSTOM',
  label: 'Custom Goals',
  shortLabel: 'Custom',
  company: 'Your call',
  contact: 'Guest',
  role: 'Custom session',
  goals: [
    {
      id: 'goal-1',
      text: 'Understand the problem and its business impact',
      keywords: ['problem', 'impact', 'cost', 'revenue', 'risk', 'customer'],
    },
    {
      id: 'goal-2',
      text: 'Map the current process, tools, and handoffs',
      keywords: ['process', 'today', 'tool', 'system', 'team', 'workflow', 'hand'],
    },
    {
      id: 'goal-3',
      text: 'Identify decision-makers, budget, and timing',
      keywords: ['budget', 'decision', 'approve', 'timeline', 'quarter', 'sign'],
    },
    {
      id: 'goal-4',
      text: 'Agree a concrete next step',
      keywords: ['next step', 'follow up', 'send', 'schedule', 'demo', 'pilot'],
    },
  ],
  lines: [],
};

export const SCENARIOS: Scenario[] = [LOGISTICS_DISCOVERY, TECH_SCREEN, CUSTOM_SCENARIO];

export const getScenario = (id: string): Scenario =>
  SCENARIOS.find((scenario) => scenario.id === id) ?? LOGISTICS_DISCOVERY;

export const INITIAL_SCENARIO_ID = LOGISTICS_DISCOVERY.id;
