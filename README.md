# PulseBrief

**Local-first hybrid AI call co-pilot — Google BuildHybridAI 2026**

PulseBrief listens to a live sales or interview call, tracks your session goals as they are covered, surfaces the follow-up question you should ask next, and — before a single byte is sent to the cloud — masks every email, phone number, address and account ID **on-device with Gemini Nano**. When the call ends, only the sanitized transcript is escalated to Cloud Gemini for the brief, CRM fields and follow-up email.

The point is not "AI in a meeting". The point is **an architecture that proves where each token was processed**, and shows the receipt.

---

## Why this exists

Most AI note-takers are cloud-first: raw audio and raw transcripts leave the device, and you are asked to trust a privacy policy. PulseBrief inverts that:

| Stage | Engine | What leaves the browser |
|---|---|---|
| Live goal tracking | Gemini Nano 4 (on-device) | **Nothing** |
| Live follow-up nudges | Gemini Nano 4 (on-device) | **Nothing** |
| PII redaction | Gemini Nano 4 + deterministic regex net | **Nothing** |
| Post-call synthesis | Cloud Gemini 2.5 Pro | Only the **sanitized** transcript |

If Nano is missing, still downloading, or the machine is offline, the app degrades deliberately instead of crashing — the status pill changes, the routing log records the fallback, and the privacy gate still runs locally.

---

## Architecture

```text
                        ┌──────────────────────────── BROWSER TAB ────────────────────────────┐
                        │                                                                     │
  microphone            │   Web Speech API                     SimulatedCallStreamer          │
  ────────────►  LiveMicRecorder ──────┐                 ┌──── scripted discovery call ────┐  │
                                      ▼                 ▼                                  │
                              ┌────────────────────────────────┐                           │
                              │      Transcript buffer          │  rolling window, per turn │
                              └───────────────┬────────────────┘                           │
                                              │                                            │
                       ┌──────────────────────┴───────────────────────┐                    │
                       ▼                                              ▼                    │
        ┌─────────────────────────────┐                  ┌──────────────────────────┐      │
        │ OP 1 evaluateLiveGoals      │                  │ OP 2 followUpNudge       │      │
        │ PREFER_ON_DEVICE            │                  │ PREFER_ON_DEVICE         │      │
        │ → status + evidence quote   │                  │ → one sharp question     │      │
        └──────────────┬──────────────┘                  └────────────┬─────────────┘      │
                       │                                              │                    │
                       └───────────────┬──────────────────────────────┘                    │
                                       ▼                                                   │
                        ┌──────────────────────────────┐                                   │
                        │ Gemini Nano 4 (on-device)    │  Firebase AI Logic                │
                        │ InferenceMode.PREFER_ON_DEVICE│  GoogleAIBackend                 │
                        └──────────────┬───────────────┘                                   │
                                       │                                                   │
                          ── End call ─┤                                                   │
                                       ▼                                                   │
                        ┌──────────────────────────────┐                                   │
                        │ OP 3 redactPiiLocally        │  ONLY_ON_DEVICE + regex safety net │
                        │ emails / phones / addresses  │  → [REDACTED_EMAIL] [REDACTED_ID] │
                        │ account IDs                  │                                   │
                        └──────────────┬───────────────┘                                   │
                                       │ sanitized transcript only                         │
                                       ▼                                                   │
                        ┌──────────────────────────────┐                                   │
                        │ OP 4 synthesizePostCallBrief │  ONLY_IN_CLOUD, gemini-2.5-pro    │
                        │ summary · CRM · email draft  │  Firestore write (offline-first)  │
                        └──────────────────────────────┘                                   │
                                                                                           │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

### The four-stage routing engine

1. **Live goal scoring** — every final transcript segment triggers a Nano pass that returns `{id, status, evidenceSnippet}` for goals that were just evidenced. Statuses only move forward.
2. **Follow-up nudges** — hedged language ("budgets are weird right now", "we kind of use spreadsheets") produces one specific question. The engine stays quiet on concrete answers and every other turn, because a co-pilot that interrupts constantly is worse than none.
3. **Privacy gate** — Nano masks PII, then a **deterministic regex pass always runs on top**. A conservative model can never be the reason an email reaches the cloud. The sanitized text must also stay ≥60% of the original length, or the model rewrite is discarded.
4. **Cloud synthesis** — the sanitized transcript goes to `gemini-2.5-pro` with `InferenceMode.ONLY_IN_CLOUD`. Result: five bullet summary, structured CRM fields, personalized follow-up email.

Routing mode is user-selectable, which is how judges can watch the split live:

| Mode | Behavior |
|---|---|
| `AUTO_HYBRID` (default) | `PREFER_ON_DEVICE` when Nano is available, otherwise `ONLY_IN_CLOUD` |
| `FORCE_LOCAL` | `ONLY_ON_DEVICE` — proves the on-device path |
| `FORCE_CLOUD` | `ONLY_IN_CLOUD` — proves the escalation path |

---

## Quick start

```bash
git clone <your-repo-url> pulsebrief
cd pulsebrief
npm install
cp .env.example .env      # optional — the app runs without it
npm run dev               # http://localhost:5173
```

**No Firebase project? No problem.** The app detects missing credentials and runs a deterministic local engine with the same four operations, same telemetry, same UI. Every judge flow works offline. The status pill says `Simulated Nano — demo engine` so nobody is misled about what answered.

### Verify the build

```bash
npm run build      # tsc --noEmit && vite build
npm run preview    # http://localhost:4173
```

---

## Firebase setup (real hybrid inference)

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. **Build → AI Logic** → get started. Firebase AI Logic must be enabled for the project before `firebase/ai` will answer.
3. **Project settings → Your apps → Web** → copy the config into `.env`:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_RECAPTCHA_SITE_KEY=...
VITE_APPCHECK_DEBUG_TOKEN=...
```

4. **App Check** → register the web app with **reCAPTCHA Enterprise**, put the site key in `VITE_RECAPTCHA_SITE_KEY`.
5. For local development, create a **debug token** in App Check → Apps → ⋮ → *Manage debug tokens*, and put it in `VITE_APPCHECK_DEBUG_TOKEN`. It is injected onto `self.FIREBASE_APPCHECK_DEBUG_TOKEN` *before* `initializeAppCheck` runs.
6. **Authentication** → enable **Anonymous** (guests) and **Google** (optional sign in that keeps a guest's briefs).
7. **Firestore** → create a database. Suggested rules (owner-scoped, append-only):

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /sessions/{sessionId} {
      allow create: if request.auth != null
                    && request.resource.data.ownerUid == request.auth.uid;
      allow read:   if request.auth != null
                    && resource.data.ownerUid == request.auth.uid;
      allow update, delete: if false;
    }
  }
}
```

Everything in `.env` is browser-visible by design — Firebase web config is public. Authorization is enforced by App Check + Security Rules, never by a hidden key.

### Enabling Gemini Nano 4 in Chrome

```text
chrome://flags/#prompt-api-for-gemini-nano          → Enabled
chrome://flags/#optimization-guide-on-device-model  → Enabled BypassPerfRequirement
```

Restart Chrome, then check availability:

```js
await LanguageModel.availability();   // "available" | "downloading" | "downloadable" | "unavailable"
```

If it returns `downloadable`, Chrome downloads the model on first use — the app shows `Nano downloading — Cloud fallback` and routes to cloud in the meantime. `chrome://on-device-internals` shows download progress.

---

## 90-second judge demo

1. Open the app. The top bar shows the live engine state and `⚡ 0 local · ☁ 0 cloud`.
2. Click **▶ Simulate live call** (set **2.5x** for speed). A realistic logistics discovery call streams into the transcript, including hedged answers and real-looking PII.
3. Watch three things happen in parallel:
   - the left rail's goals flip `Pending → Partial → Covered` with the exact quote that proved them;
   - the right rail produces follow-up questions tagged `⚡ Local Nano · 310ms · Raw audio stayed in RAM`;
   - the routing log appends every inference call with its engine and latency.
4. Toggle **Force Local** / **Force Cloud** mid-call and watch the status pill and the routing log change engine.
5. Toggle Chrome DevTools → Network → **Offline**: the pill turns orange (`Offline Mode — Local Nano Active`) instantly.
6. Click **✨ End call & synthesize**. You see the two-step progress: local PII redaction → cloud synthesis. The brief opens with the goal outcomes, CRM JSON, email draft, sanitized transcript diff toggle, and the telemetry receipt.
7. Close the tab, go offline, or kill the network — the session is written to IndexedDB/localStorage and the receipt says `Queued offline in IndexedDB` / `Stored locally in this browser`.

Deep links for screenshots / verification:

```text
/?seed=1              seeds the full discovery transcript, runs one analysis pass
/?seed=1&brief=1      also runs redaction + synthesis and opens the brief
```

---

## Where the Firebase AI Logic code lives

`src/services/hybridAI.ts` is the single place where the hybrid routing happens:

```ts
import {
  GoogleAIBackend, InferenceMode, getAI, getGenerativeModel,
} from 'firebase/ai';

const ai = getAI(app, { backend: new GoogleAIBackend() });

// On-device preferred — falls back to cloud inside the SDK when Nano is absent
getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE,
  inCloudParams: { model: 'gemini-2.5-flash', generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } },
});

// Hard local — used by FORCE_LOCAL and the privacy gate
getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE, /* ... */ });

// Cloud only — post-call synthesis
getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_IN_CLOUD,
  inCloudParams: { model: 'gemini-2.5-pro', generationConfig: { temperature: 0.3, responseMimeType: 'application/json' } },
});
```

Other integration points:

| Concern | File |
|---|---|
| App init, App Check + debug token, anonymous auth, IndexedDB-persisted Firestore | `src/config/firebase.ts` |
| Capability detection (`LanguageModel.availability()` / `capabilities()`) | `src/services/hybridAI.ts` → `checkOnDeviceNanoStatus()` |
| Firestore CRUD + offline queue + localStorage fallback | `src/services/sessionStore.ts` |
| Web Speech API wrapper + scripted streamer | `src/services/speechService.ts` |

Every call is wrapped in `performance.now()` timing and mapped to telemetry, which is what the receipt renders. `mergeTelemetry` is the only writer.

---

## Privacy model, precisely

- **PulseBrief never records, stores or uploads audio.** Speech to text is done by the browser's own Web Speech API, and Chrome may use Google's speech service for that step. Only the resulting text is used by the app, and it is masked on this device before any cloud model sees it.
- **PII masking is deterministic-first.** Regex masks emails, phones (9–15 digits), street addresses, SSNs and account IDs (`ACCT-88213`, `PO-12345`, …). The Nano pass runs *before* the regex net, and its output is re-scanned.
- **The cloud never sees the raw transcript.** `synthesizePostCallBrief` accepts only the sanitized string; the raw text is kept in memory for the transcript toggle and is never included in the cloud prompt.
- **Local persistence is opt-in by configuration.** Without Firebase, sessions stay in `localStorage`; with Firebase, they go to owner-scoped Firestore documents with offline persistence enabled.
- **No secrets in the bundle.** Only `VITE_*` public config; nothing is hardcoded.

Known limits, stated honestly:

- Gemini Nano quality varies by Chrome build; the deterministic demo engine is intentionally more predictable than the real model.
- Web Speech API is Chrome/Edge only; Firefox and Safari fall back to the simulated call.
- The brief is only as good as the transcript — the prompt forbids inventing facts, but the local fallback synthesis is template-driven by design.
- `responseMimeType: application/json` is honoured by both models, but every parse is still guarded (`extractJson`) and falls back locally rather than crashing.

---

## Project structure

```text
pulsebrief/
├── .env.example                     # every VITE_* key, documented
├── .gitignore
├── LICENSE                          # Apache 2.0
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── main.tsx
    ├── App.tsx                      # session state machine + inference orchestration
    ├── App.module.css
    ├── types/session.ts             # goals, nudges, telemetry, brief contracts
    ├── styles/
    │   ├── variables.css            # design tokens + hybrid AI semantic colors
    │   └── global.css
    ├── config/firebase.ts
    ├── services/
    │   ├── hybridAI.ts              # 4 hybrid operations + demo engine
    │   ├── speechService.ts         # live mic + simulated call streamer
    │   └── sessionStore.ts
    ├── data/demoScenario.ts         # logistics discovery + technical screen
    └── components/
        ├── TopBar/                  # engine pill, routing control, telemetry
        ├── GoalSidebar/             # scenario, progress, evidence quotes
        ├── LiveTranscript/          # capture controls + caption feed
        ├── CoPilotFeed/             # nudges + routing audit log
        ├── PostCallBriefModal/      # 2-step progress + brief
        └── TelemetryReceipt/        # local vs cloud proof
```

Styling is **CSS Modules only** — no Tailwind, no CSS-in-JS, no component library. Tokens live in `src/styles/variables.css`; light and dark themes are a single `data-theme` attribute flip.

---

## Scripts

```bash
npm run dev        # Vite dev server on 0.0.0.0:5173
npm run build      # typecheck + production bundle
npm run preview    # serve the production build on 0.0.0.0:4173
npm run typecheck  # tsc --noEmit
```

## License

Apache 2.0 — see [LICENSE](./LICENSE).
