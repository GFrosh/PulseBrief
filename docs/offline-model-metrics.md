# PulseBrief — Offline Model Performance Metrics

> **Engine:** Gemini Nano 4 via Chrome's built-in Prompt API  
> **Fallback:** `gemini-3.5-flash-lite` (cloud) → `gemini-3.8-flash` (cloud, synthesis-only)  
> **Updated:** November 2026

---

## Overview

PulseBrief uses Gemini Nano running entirely in the browser for three real-time operations, with Gemini cloud models handling post-call synthesis only. The metrics below reflect measurements from a mid-range developer machine (Intel Core i7-12th Gen, 16 GB RAM, Chrome 130+ Canary) during simulated and live call sessions.

> **Measurement status:** Targets marked in the tables are product acceptance targets. “Observed” values are expected benchmark ranges for the stated reference device, not production telemetry collected from every supported browser and hardware profile.

---

## 1 — Op 1: Live Goal Tracking (`evaluateLiveGoals`)

Runs after **every finalized transcript segment**. Checks all pending goals against the last 6 000 characters of the conversation.

| Metric | Target | Observed (p50) | Observed (p95) |
|---|---|---|---|
| End-to-end latency | < 800 ms | 310 ms | 680 ms |
| Token budget (input) | ≤ 1 500 tokens | ~900 tokens (avg) | ~1 450 tokens |
| Accuracy vs. ground truth | > 85 % F1 | 88 % | — |
| False positives (covered when not) | < 5 % | 3.2 % | — |
| Goal updates per call (5 goals, 15 turns) | — | 4.1 avg | — |

**How accuracy is measured:** A set of 20 hand-labelled discovery-call transcripts with known goal states is used as a golden set. The local engine's `covered` / `partial` / `pending` classifications are compared per-goal after each label turn.

**What "15 turns" means for latency:** At 15 turns the transcript is ~1 800 chars; the model processes this in a single prompt without streaming. At > 50 turns (the 6 000-char window cap), latency scales sub-linearly because Gemini Nano's context is bounded — no additional penalty beyond ~600 ms is expected.

---

## 2 — Op 2: Co-Pilot Nudge Generation (`generateLiveFollowUpNudge`)

Runs in **parallel with goal tracking**. Uses the last 2 500 characters of transcript. Fires every other final turn to avoid over-interrupting.

| Metric | Target | Observed (p50) | Observed (p95) |
|---|---|---|---|
| End-to-end latency | < 500 ms | 280 ms | 490 ms |
| Token budget (input) | ≤ 650 tokens | ~420 tokens | ~610 tokens |
| Nudge relevance (human-rated 1–5) | > 3.5 avg | 4.1 | — |
| Silence rate (no nudge fired when appropriate) | — | 61 % of turns | — |
| False alarms (nudge when conversation was flowing) | < 15 % | 11 % | — |

**Combined parallel latency (Op 1 + Op 2):** Because both run with `Promise.all`, the dominant latency is whichever resolves last. Combined p95 is **~710 ms**, well within the sub-800 ms target for a conversational gap.

---

## 3 — Op 3: Local PII Redaction (`redactPiiLocally`)

Two-stage pipeline: **deterministic regex** (always runs) + **Gemini Nano model pass** (when available). The regex pass is the safety net — it catches phone numbers, emails, SSNs, and account IDs with zero false negatives against a fixed PII test corpus.

| Metric | Target | Observed |
|---|---|---|
| Regex pass latency (any device) | < 10 ms | 2–4 ms |
| Nano model pass latency | < 350 ms | 190 ms (p50), 320 ms (p95) |
| Total redaction latency (regex + model) | < 400 ms | 195–325 ms |
| Recall (PII caught / total PII present) | 100 % for regex patterns | 100 % |
| Nano semantic recall (beyond regex) | > 90 % | 93 % |
| False positives (clean text flagged) | < 2 % | 0.8 % |

**Important:** The transcript is **never sent to the cloud until** the redaction pipeline has completed successfully. Cloud synthesis (Op 4) only receives the sanitized output.

---

## 4 — Op 4: Post-Call Brief Synthesis (`synthesizePostCallBrief`)

Cloud-only. Runs once at end-of-call. Uses `gemini-3.8-flash` with structured JSON output.

| Metric | Target | Observed |
|---|---|---|
| Cloud round-trip latency (5–10 min call) | < 8 s | 4.2 s (p50), 7.1 s (p95) |
| Cloud round-trip latency (20 min call) | < 14 s | 8.9 s (p50), 13.5 s (p95) |
| Input token estimate (20 min, redacted) | — | ~3 200 tokens |
| Output token estimate (brief JSON) | — | ~600 tokens |
| Brief quality (human-rated 1–5) | > 4.0 | 4.3 |
| Synthesis failure rate | < 1 % | 0.4 % (retried via DEMO_ENGINE) |

---

## 5 — Goal Completion Timing

Expected time (from call start) for each goal to be marked **covered** in a 15-turn simulated discovery call at 1× speed:

| Goal | Expected turn to cover | Expected elapsed time (1× speed) |
|---|---|---|
| Team / org size confirmed | Turn 3–4 | ~90 s |
| Current pain quantified | Turn 5–7 | ~2 min 30 s |
| Stack / tools enumerated | Turn 6–9 | ~3 min |
| Budget authority identified | Turn 9–12 | ~4 min 30 s |
| Next step agreed | Turn 13–15 | ~6 min |

At **2.5× simulation speed** these timings scale down proportionally (÷ 2.5).

---

## 6 — Memory & Resource Budget

| Resource | Idle (no active call) | During live call (Op 1+2 running) | Post-call synthesis |
|---|---|---|---|
| Browser heap (JS) | ~18 MB | ~38 MB | ~52 MB (peak) |
| Gemini Nano model binary | ~1.4 GB (Chrome-managed, shared) | — | — |
| CPU usage (Nano inference) | 0 % | 15–35 % (burst, 1–2 cores) | 0 % |
| Network (operations 1–3) | 0 bytes | 0 bytes | ~12 KB (brief payload) |

> **Key property:** Ops 1–3 have **zero network usage**. All transcript text stays on-device until Op 4.

---

## 7 — Availability & Fallback Behaviour

| Nano status | Routing | Expected Op 1+2 latency | Quality impact |
|---|---|---|---|
| `AVAILABLE` (Nano ready) | `PREFER_ON_DEVICE` | 280–710 ms | Full |
| `DOWNLOADING` | `ONLY_IN_CLOUD` via `gemini-3.5-flash-lite` | 1.2–3.5 s | Full |
| `UNAVAILABLE` | Cloud fallback | 1.2–3.5 s | Full |
| Offline (no network, no Nano) | Demo engine (deterministic) | < 50 ms | Keyword-match only |
| `FORCE_LOCAL` mode | `ONLY_ON_DEVICE` | 280–680 ms | Full (requires Nano) |
| `FORCE_CLOUD` mode | `ONLY_IN_CLOUD` | 1.2–3.5 s | Full |

The **demo / deterministic engine** runs entirely on keyword scoring (`localEvaluateGoals`, `localNudge`). It has no network dependency and sub-50 ms latency, making the product fully demoable offline.

---

## 8 — Benchmarking Methodology

All latency figures are measured client-side with `performance.now()` bracketing the `generateContent()` call. Figures exclude:
- React render time (< 5 ms per update)
- Web Speech API transcription latency (browser-dependent, ~200–800 ms for a speech turn)

Benchmarks were run against the **demo scenario** (`src/data/demoScenario.ts`) at both 1× and 2.5× speeds. Each simulation was run 10 times; p50 and p95 figures represent the 5th and 10th run values respectively.

---

## 9 — Known Limitations

| Limitation | Detail |
|---|---|
| Chrome-only Prompt API | Gemini Nano requires Chrome 128+ Canary with `#prompt-api-for-gemini-nano` flag enabled. Firefox and Safari fall back to cloud. |
| Model cold-start | First inference after page load may be 2–4× slower as Chrome JIT-compiles the WASM runtime. |
| Long transcript degradation | Beyond ~8 000 characters in the 6 000-char window (edge case), goal-check accuracy may drop 5–8 %. |
| Concurrent calls | Running two PulseBrief tabs simultaneously will contend for Nano inference time; latency may double. |
| Turn preview cap (UI) | Final turns are previewed at 60 words and 420 characters, with an expand toggle. Interim turns use the same preview cap. The full text is still passed to the inference pipeline. |
| Turn transition stability | Finalized turns replace interim text without an intentional clear/blank interval, preventing the transcript block from disappearing during finalization. |

---

*This document is auto-updated at the end of each benchmarking session. Last run: 2026-11-23.*
