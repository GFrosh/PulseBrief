import { useCallback, useEffect, useRef, useState } from 'react';
import TopBar from './components/TopBar/TopBar';
import GoalSidebar from './components/GoalSidebar/GoalSidebar';
import LiveTranscript from './components/LiveTranscript/LiveTranscript';
import CoPilotFeed from './components/CoPilotFeed/CoPilotFeed';
import PostCallBriefModal from './components/PostCallBriefModal/PostCallBriefModal';
import RuntimeStatusBanner from './components/RuntimeStatusBanner/RuntimeStatusBanner';
import AccountAndHistoryModal from './components/AccountAndHistoryModal/AccountAndHistoryModal';
import type {
  ActivityEntry,
  CoPilotNudge,
  InferenceTelemetry,
  InferenceSource,
  NanoAvailability,
  PostCallBrief,
  RoutingMode,
  Scenario,
  SessionGoal,
  Speaker,
  SyncStatus,
  TranscriptSegment,
} from './types/session';
import { getScenario, INITIAL_SCENARIO_ID } from './data/demoScenario';
import {
  LiveMicRecorder,
  SimulatedCallStreamer,
  isLiveMicSupported,
  scenarioDurationSeconds,
  TabAudioCapture,
} from './services/speechService';
import {
  applyDeterministicRedaction,
  checkOnDeviceNanoStatus,
  createEmptyTelemetry,
  evaluateLiveGoals,
  generateLiveFollowUpNudge,
  isCloudReady,
  isDemoEngine,
  mergeTelemetry,
  nudgeFromDraft,
  redactPiiLocally,
  synthesizePostCallBrief,
} from './services/hybridAI';
import { listLocalSessions, listSessions, saveSession } from './services/sessionStore';
import { getGuestId, isExtensionOrigin, watchAuthSession, type AuthSession } from './config/firebase';
import styles from './App.module.css';

type ModalPhase = 'ready' | 'redacting' | 'cloud';
type MobilePane = 'transcript' | 'goals' | 'copilot';
const OPEN_CALL_ID = 'OPEN_FREEFORM';

const makeId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

const buildTranscript = (segments: TranscriptSegment[]): string =>
  segments.map((segment) => `${segment.speaker}: ${segment.text}`).join('\n');

const hasPii = (text: string): boolean => applyDeterministicRedaction(text).redactionCount > 0;

const seedGoals = (scenario: Scenario): SessionGoal[] =>
  scenario.goals.map((goal) => ({
    id: goal.id,
    text: goal.text,
    status: 'pending',
    keywords: [...goal.keywords],
  }));

const formatElapsed = (seconds: number): string =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

/** Automated screenshot / smoke-test mode: same pipeline, no artificial pacing. */
const CAPTURE_MODE =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('capture') === '1';

export default function App() {
  const [mobilePane, setMobilePane] = useState<MobilePane>('transcript');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = window.localStorage.getItem('pulsebrief-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  const [scenarioId, setScenarioId] = useState<string>(OPEN_CALL_ID);
  const [goals, setGoals] = useState<SessionGoal[]>([]);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [interim, setInterim] = useState<{ speaker: Speaker; text: string } | null>(null);
  const [nudges, setNudges] = useState<CoPilotNudge[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [telemetry, setTelemetry] = useState<InferenceTelemetry>(() => createEmptyTelemetry());
  const [routingMode, setRoutingMode] = useState<RoutingMode>('AUTO_HYBRID');
  const [nano, setNano] = useState<NanoAvailability>('CHECKING');
  const [nanoDetail, setNanoDetail] = useState<string>('');
  const [online, setOnline] = useState<boolean>(() => navigator.onLine);
  const [dismissedBanner, setDismissedBanner] = useState<string | null>(null);
  const [authSession, setAuthSession] = useState<AuthSession>(() => ({
    uid: getGuestId(),
    email: null,
    displayName: 'Local Guest',
    isAnonymous: true,
    isGuest: true,
  }));
  const [savedCount, setSavedCount] = useState<number>(() => listLocalSessions(getGuestId()).length);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountModalTab, setAccountModalTab] = useState<'account' | 'history'>('history');
  const [listening, setListening] = useState(false);
  const [tabMode, setTabMode] = useState(false);
  const [audioLevels, setAudioLevels] = useState({ mic: 0, tab: 0 });
  const [manualSpeaker, setManualSpeaker] = useState<Speaker | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [enableMicPrompt, setEnableMicPrompt] = useState(false);
  const [micGrantNotice, setMicGrantNotice] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [phase, setPhase] = useState<ModalPhase>('ready');
  const [brief, setBrief] = useState<PostCallBrief | null>(null);
  const [redactionCount, setRedactionCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('SAVING');

  const scenario = getScenario(scenarioId === OPEN_CALL_ID ? INITIAL_SCENARIO_ID : scenarioId);

  const goalsRef = useRef(goals);
  const segmentsRef = useRef<TranscriptSegment[]>(segments);
  const telemetryRef = useRef<InferenceTelemetry>(telemetry);
  const nanoRef = useRef<NanoAvailability>('CHECKING');
  const routingRef = useRef<RoutingMode>('AUTO_HYBRID');
  const speedRef = useRef(1);
  const manualSpeakerRef = useRef<Speaker | null>(null);
  const interimBySpeakerRef = useRef<Partial<Record<Speaker, string>>>({});
  const displayedInterimSpeakerRef = useRef<Speaker | null>(null);
  const audioMeterFrameRef = useRef<number | null>(null);
  const turnCountRef = useRef(0);
  const recorderRef = useRef<LiveMicRecorder | null>(null);
  const micRecorderRef = useRef<LiveMicRecorder | null>(null);
  const tabRecognitionActiveRef = useRef(false);
  const micRecognitionActiveRef = useRef(false);
  const tabCaptureRef = useRef<TabAudioCapture | null>(null);
  const streamerRef = useRef<SimulatedCallStreamer | null>(null);
  const analysisBusyRef = useRef(false);
  const analysisPendingRef = useRef(false);
  const analysisGenerationRef = useRef(0);
  const synthBusyRef = useRef(false);
  const seededRef = useRef(false);
  const bootedAtRef = useRef(Date.now());

  useEffect(() => {
    goalsRef.current = goals;
  }, [goals]);

  useEffect(() => {
    routingRef.current = routingMode;
  }, [routingMode]);

  useEffect(() => {
    nanoRef.current = nano;
  }, [nano]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('pulsebrief-theme', theme);
  }, [theme]);

  /* --- Environment probes ------------------------------------------------ */

  const refreshNanoStatus = useCallback(() => {
    checkOnDeviceNanoStatus().then((result) => {
      setNano(result.status);
      setNanoDetail(result.detail);
      nanoRef.current = result.status;
      setDismissedBanner(null);
    });
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('grantMic') !== '1') return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then((granted) => {
      granted.getTracks().forEach((track) => track.stop());
      setMicGrantNotice('Microphone enabled. Close this tab and return to the PulseBrief Side Panel.');
    }).catch(() => setMicGrantNotice('Microphone permission was not granted. Try again from this tab.'));
  }, []);

  const openMicGrant = useCallback(() => {
    const target = `${window.location.origin}${window.location.pathname}?grantMic=1`;
    const chromeApi = (window as Window & { chrome?: { tabs?: { create(options: { url: string }): void }; runtime?: { getURL(path: string): string } } }).chrome;
    const url = chromeApi?.runtime?.getURL('index.html?grantMic=1') ?? target;
    if (chromeApi?.tabs?.create) chromeApi.tabs.create({ url });
    else window.open(url, '_blank', 'noopener');
  }, []);

  useEffect(() => {
    let cancelled = false;
    checkOnDeviceNanoStatus().then((result) => {
      if (!cancelled) {
        setNano(result.status);
        setNanoDetail(result.detail);
        nanoRef.current = result.status;
      }
    });
    const handleOnline = () => {
      setOnline(true);
      setDismissedBanner(null);
    };
    const handleOffline = () => {
      setOnline(false);
      setDismissedBanner(null);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    const unsubAuth = watchAuthSession((nextSession) => {
      if (!cancelled) {
        setAuthSession(nextSession);
        listSessions(nextSession.uid).then((items) => {
          if (!cancelled) setSavedCount(items.length);
        });
      }
    });
    return () => {
      cancelled = true;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubAuth();
    };
  }, []);

  useEffect(() => {
    if (!listening && !simulating) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [listening, simulating]);

  /* --- Telemetry & audit helpers ---------------------------------------- */

  const applyTelemetry = useCallback((updater: (previous: InferenceTelemetry) => InferenceTelemetry) => {
    telemetryRef.current = updater(telemetryRef.current);
    setTelemetry(telemetryRef.current);
  }, []);

  const pushActivity = useCallback(
    (source: InferenceSource, operation: string, detail: string, latencyMs: number) => {
      const entry: ActivityEntry = {
        id: makeId('log'),
        at: new Date().toISOString(),
        source,
        operation,
        detail,
        latencyMs,
      };
      setActivity((previous) => [...previous.slice(-59), entry]);
    },
    [],
  );

  const recordCall = useCallback(
    (source: InferenceSource, latencyMs: number, inputText: string) => {
      if (latencyMs <= 0) return;
      const isCloud = source === 'CLOUD_GEMINI' || source === 'CLOUD_FALLBACK';
      applyTelemetry((previous) =>
        mergeTelemetry(previous, { data: null, meta: { source, latencyMs, tokens: 0 } }, isCloud ? 'cloud' : 'local', inputText),
      );
    },
    [applyTelemetry],
  );

  /* --- Live analysis loop ------------------------------------------------ */

  const analyzeTranscript = useCallback(async () => {
    if (analysisBusyRef.current) {
      analysisPendingRef.current = true;
      return;
    }
    analysisBusyRef.current = true;
    const generation = analysisGenerationRef.current;

    try {
      do {
        analysisPendingRef.current = false;
        const transcript = buildTranscript(segmentsRef.current);
        if (!transcript.trim()) break;
        // FORCE_CLOUD applies to live inference too; sanitize before either live
        // prompt so raw PII never leaves the browser before the final gate.
        const safeTranscript = applyDeterministicRedaction(transcript).sanitizedTranscript;

        const [goalResult, nudgeResult] = await Promise.all([
          evaluateLiveGoals(safeTranscript.slice(-6000), goalsRef.current, routingRef.current, nanoRef.current),
          generateLiveFollowUpNudge(
            safeTranscript.slice(-2500),
            goalsRef.current,
            routingRef.current,
            nanoRef.current,
            turnCountRef.current,
          ),
        ]);

        // A scenario/session reset may happen while an inference request is in
        // flight. Discard results from the previous session before touching UI.
        if (generation !== analysisGenerationRef.current) break;

        recordCall(goalResult.meta.source, goalResult.meta.latencyMs, transcript);
        recordCall(nudgeResult.meta.source, nudgeResult.meta.latencyMs, transcript);

        if (goalResult.data.updates.length > 0) {
          setGoals((previous) => {
            const next = previous.map((goal) => {
              const update = goalResult.data.updates.find((entry) => entry.id === goal.id);
              const rank = { pending: 0, partial: 1, covered: 2 };
              if (!update || rank[update.status] <= rank[goal.status]) return goal;
              return {
                ...goal,
                status: update.status,
                evidenceSnippet: update.evidenceSnippet ?? goal.evidenceSnippet,
                updatedBy: goalResult.meta.source === 'CLOUD_GEMINI' || goalResult.meta.source === 'CLOUD_FALLBACK'
                  ? ('CLOUD_GEMINI' as const)
                  : ('LOCAL_NANO' as const),
                latencyMs: goalResult.meta.latencyMs,
              };
            });
            goalsRef.current = next;
            return next;
          });

          const snippets = goalResult.data.updates
            .map((update) => update.evidenceSnippet ?? '')
            .filter((snippet) => snippet.length > 12);

          if (snippets.length > 0) {
            setSegments((previous) => {
              const next = previous.map((segment) => {
                const matches = snippets.some(
                  (snippet) => segment.text.includes(snippet.slice(0, 28)) || snippet.includes(segment.text.slice(0, 28)),
                );
                if (!matches) return segment;
                return {
                  ...segment,
                  matchedGoalIds: Array.from(new Set([...(segment.matchedGoalIds ?? []), 'evidence'])),
                };
              });
              segmentsRef.current = next;
              return next;
            });
          }

          goalResult.data.updates.forEach((update) => {
            const index = goalsRef.current.findIndex((goal) => goal.id === update.id);
            pushActivity(
              goalResult.meta.source,
              'GOAL_CHECK',
              `Goal #${index + 1} ${update.status === 'covered' ? 'covered' : update.status}`,
              goalResult.meta.latencyMs,
            );
          });
        } else {
          pushActivity(goalResult.meta.source, 'GOAL_CHECK', 'Goal sweep · no change', goalResult.meta.latencyMs);
        }

        const nudge = nudgeFromDraft(nudgeResult.data, nudgeResult.meta);
        if (nudge) {
          setNudges((previous) =>
            previous.some((entry) => entry.suggestedQuestion === nudge.suggestedQuestion)
              ? previous
              : [nudge, ...previous],
          );
          pushActivity(
            nudgeResult.meta.source,
            'NUDGE',
            `Follow-up · ${nudge.triggerType.replace(/_/g, ' ').toLowerCase()}`,
            nudgeResult.meta.latencyMs,
          );
        } else {
          pushActivity(nudgeResult.meta.source, 'NUDGE', 'Nudge sweep · quiet', nudgeResult.meta.latencyMs);
        }
      } while (analysisPendingRef.current);
    } catch (analysisError) {
      console.error('[PulseBrief] Analysis loop failed', analysisError);
    } finally {
      analysisBusyRef.current = false;
      if (analysisPendingRef.current) void analyzeTranscript();
    }
  }, [pushActivity, recordCall]);

  /* --- Audio pipeline ---------------------------------------------------- */

  const handleInterim = useCallback((speaker: Speaker, text: string) => {
    const trimmed = text.trim();
    if (trimmed) interimBySpeakerRef.current[speaker] = trimmed;
    else delete interimBySpeakerRef.current[speaker];
    if (trimmed) {
      displayedInterimSpeakerRef.current = speaker;
      setInterim({ speaker: manualSpeakerRef.current ?? speaker, text: trimmed });
    } else {
      setInterim((current) => {
        if (displayedInterimSpeakerRef.current !== speaker) return current;
        const remaining = Object.entries(interimBySpeakerRef.current).find(([, value]) => value);
        displayedInterimSpeakerRef.current = remaining ? remaining[0] as Speaker : null;
        return remaining ? { speaker: manualSpeakerRef.current ?? remaining[0] as Speaker, text: remaining[1] as string } : null;
      });
    }
  }, []);

  const handleFinal = useCallback(
    (speaker: Speaker, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      delete interimBySpeakerRef.current[speaker];
      setInterim((current) => {
        if (displayedInterimSpeakerRef.current !== speaker) return current;
        const remaining = Object.entries(interimBySpeakerRef.current).find(([, value]) => value);
        displayedInterimSpeakerRef.current = remaining ? remaining[0] as Speaker : null;
        return remaining ? { speaker: manualSpeakerRef.current ?? remaining[0] as Speaker, text: remaining[1] as string } : null;
      });

      const segment: TranscriptSegment = {
        id: makeId('seg'),
        speaker: manualSpeakerRef.current ?? speaker,
        text: trimmed,
        timestamp: new Date().toISOString(),
        isFinal: true,
        containsPii: hasPii(trimmed),
      };

      segmentsRef.current = [...segmentsRef.current, segment];
      setSegments(segmentsRef.current);
      turnCountRef.current += 1;
      void analyzeTranscript();
    },
    [analyzeTranscript],
  );

  const stopAll = useCallback(() => {
    if (audioMeterFrameRef.current !== null) cancelAnimationFrame(audioMeterFrameRef.current);
    audioMeterFrameRef.current = null;
    recorderRef.current?.stop();
    recorderRef.current = null;
    micRecorderRef.current?.stop();
    micRecorderRef.current = null;
    tabRecognitionActiveRef.current = false;
    micRecognitionActiveRef.current = false;
    tabCaptureRef.current?.stop();
    tabCaptureRef.current = null;
    setTabMode(false);
    setAudioLevels({ mic: 0, tab: 0 });
    streamerRef.current?.stop();
    streamerRef.current = null;
    setListening(false);
    setSimulating(false);
    setInterim(null);
    interimBySpeakerRef.current = {};
    displayedInterimSpeakerRef.current = null;
  }, []);

  const cycleSpeakerMode = useCallback(() => {
    setManualSpeaker((current) => {
      const next = current === null ? 'You (Interviewer)' : current === 'You (Interviewer)' ? 'Guest (Prospect)' : null;
      manualSpeakerRef.current = next;
      return next;
    });
  }, []);

  const flipSegmentSpeaker = useCallback((id: string) => {
    const next = segmentsRef.current.map((segment) => segment.id === id ? {
      ...segment,
      speaker: segment.speaker === 'You (Interviewer)' ? 'Guest (Prospect)' as const : 'You (Interviewer)' as const,
    } : segment);
    segmentsRef.current = next;
    setSegments(next);
  }, []);

  const resetSession = useCallback(() => {
    stopAll();
    analysisGenerationRef.current += 1;
    analysisPendingRef.current = false;
    manualSpeakerRef.current = null;
    setManualSpeaker(null);
    segmentsRef.current = [];
    setSegments([]);
    setNudges([]);
    setActivity([]);
    setInterim(null);
    telemetryRef.current = createEmptyTelemetry();
    setTelemetry(telemetryRef.current);
    turnCountRef.current = 0;
    setElapsed(0);
    setBrief(null);
    setModalOpen(false);
    setRedactionCount(0);
    setSyncStatus('SAVING');
    setPhase('ready');
    setError(null);
    setGoals((previous) => {
      const next = previous.map((goal) => ({
        ...goal,
        status: 'pending' as const,
        evidenceSnippet: undefined,
        updatedBy: undefined,
        latencyMs: undefined,
      }));
      goalsRef.current = next;
      return next;
    });
  }, [stopAll]);

  const startMic = useCallback(() => {
    resetSession();
    if (!isLiveMicSupported()) {
      setError('This browser has no Web Speech API. Use Chrome or Edge, or run the simulated call.');
      return;
    }
    const recorder = new LiveMicRecorder({
      onInterim: handleInterim,
      onFinal: handleFinal,
      onError: (message) => { setError(message); if (/microphone|mic|not allowed/i.test(message)) setEnableMicPrompt(true); },
      onListeningChange: (value) => {
        micRecognitionActiveRef.current = value;
        setListening(value || tabRecognitionActiveRef.current);
      },
    });
    recorderRef.current = recorder;
    recorder.start();
  }, [handleFinal, handleInterim, resetSession]);

  const stopMic = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    micRecorderRef.current?.stop();
    micRecorderRef.current = null;
    tabCaptureRef.current?.stop();
    tabCaptureRef.current = null;
    tabRecognitionActiveRef.current = false;
    micRecognitionActiveRef.current = false;
    setTabMode(false);
    setListening(false);
    setAudioLevels({ mic: 0, tab: 0 });
  }, []);

  const startTabAudio = useCallback(async () => {
    resetSession();
    if (!isLiveMicSupported()) { setError('Speech recognition is unavailable. Use Chrome or Edge.'); return; }
    const capture = new TabAudioCapture();
    tabCaptureRef.current = capture;
    capture.onLevels = (mic, tab) => {
      if (audioMeterFrameRef.current !== null) cancelAnimationFrame(audioMeterFrameRef.current);
      audioMeterFrameRef.current = requestAnimationFrame(() => {
        audioMeterFrameRef.current = null;
        setAudioLevels({ mic, tab });
      });
    };
    capture.onEnded = () => {
      recorderRef.current?.stop(); recorderRef.current = null;
      micRecorderRef.current?.stop(); micRecorderRef.current = null;
      tabRecognitionActiveRef.current = false;
      micRecognitionActiveRef.current = false;
      capture.stop(); tabCaptureRef.current = null; setTabMode(false); setListening(false);
      setError('Meeting tab sharing ended. You can start a new capture at any time.');
    };
    try {
      await capture.start();
      if (capture.micDenied) {
        if (isExtensionOrigin) setEnableMicPrompt(true);
        setError('Microphone access is unavailable; the shared tab will transcribe, but your speech will not.');
      }
      setTabMode(true);
      const tabTrack = capture.tabSpeechTrack;
      if (!tabTrack) throw new Error('No live tab audio track was available for speech recognition.');
      const makeCallbacks = (speaker: Speaker, source: 'tab' | 'mic') => ({
        onInterim: (_recognizedSpeaker: Speaker, text: string) => handleInterim(speaker, text),
        onFinal: (_recognizedSpeaker: Speaker, text: string) => handleFinal(speaker, text),
        onError: (message: string) => { setError(message); if (/microphone|mic|not allowed/i.test(message)) setEnableMicPrompt(true); },
        onListeningChange: (value: boolean) => {
          if (source === 'tab') tabRecognitionActiveRef.current = value;
          else micRecognitionActiveRef.current = value;
          setListening(tabRecognitionActiveRef.current || micRecognitionActiveRef.current);
        },
      });
      const tabRecorder = new LiveMicRecorder(makeCallbacks('Guest (Prospect)', 'tab'), tabTrack);
      recorderRef.current = tabRecorder;
      const tabStarted = tabRecorder.start();
      const micTrack = capture.microphoneSpeechTrack;
      const micRecorder = micTrack
        ? new LiveMicRecorder(makeCallbacks('You (Interviewer)', 'mic'), micTrack)
        : null;
      micRecorderRef.current = micRecorder;
      const micStarted = micRecorder?.start() ?? false;
      if (!tabStarted && !micStarted) {
        recorderRef.current = null;
        micRecorderRef.current = null;
        capture.stop(); tabCaptureRef.current = null; setTabMode(false);
        setError('Could not start speech recognition from the shared audio. Update Chrome or Edge and try again.');
        return;
      }
    } catch (cause) {
      capture.stop(); tabCaptureRef.current = null; setTabMode(false);
      const cancelled = cause instanceof DOMException && cause.name === 'NotAllowedError';
      setError(cancelled ? 'Tab audio selection was cancelled.' : cause instanceof Error ? cause.message : 'Could not capture tab audio. Check Chrome tab audio sharing permissions.');
    }
  }, [handleFinal, handleInterim, resetSession]);

  const stopTabAudio = useCallback(() => {
    recorderRef.current?.stop(); recorderRef.current = null;
    micRecorderRef.current?.stop(); micRecorderRef.current = null;
    tabCaptureRef.current?.stop(); tabCaptureRef.current = null;
    tabRecognitionActiveRef.current = false;
    micRecognitionActiveRef.current = false;
    setTabMode(false); setListening(false); setAudioLevels({ mic: 0, tab: 0 });
  }, []);

  const startSimulation = useCallback(() => {
    resetSession();
    const simulationScenarioId = scenarioId === OPEN_CALL_ID ? INITIAL_SCENARIO_ID : scenarioId;
    const simulationScenario = getScenario(simulationScenarioId);
    if (simulationScenarioId !== scenarioId) {
      setScenarioId(simulationScenarioId);
      const simulationGoals = seedGoals(simulationScenario);
      goalsRef.current = simulationGoals;
      setGoals(simulationGoals);
    }
    const streamer = new SimulatedCallStreamer({
      scenario: simulationScenario,
      speed: speedRef.current,
      onInterim: handleInterim,
      onFinal: handleFinal,
      onError: (message) => setError(message),
      onListeningChange: (value) => setSimulating(value),
      onComplete: () => {
        setSimulating(false);
        setInterim(null);
      },
    });
    streamerRef.current = streamer;
    streamer.start();
    setSimulating(true);
  }, [handleFinal, handleInterim, resetSession, scenarioId]);

  const stopSimulation = useCallback(() => {
    streamerRef.current?.stop();
    streamerRef.current = null;
    setSimulating(false);
    setInterim(null);
  }, []);

  const handleSpeedChange = useCallback((value: number) => {
    setSpeed(value);
    speedRef.current = value;
    streamerRef.current?.setSpeed(value);
  }, []);

  /* --- Post-call pipeline ------------------------------------------------ */

  const handleEndCall = useCallback(async () => {
    if (synthBusyRef.current) return;
    if (segmentsRef.current.length === 0) {
      setError('Nothing to synthesize yet — start the mic or run the simulated call first.');
      return;
    }

    synthBusyRef.current = true;
    stopAll();
    if (analysisBusyRef.current) {
      analysisPendingRef.current = true;
      while (analysisBusyRef.current) await sleep(20);
    }
    setModalOpen(true);
    setPhase('redacting');
    setBrief(null);
    setRedactionCount(0);
    setSyncStatus('SAVING');
    setError(null);

    try {
      const fullTranscript = buildTranscript(segmentsRef.current);

      // Step 1 — privacy gate, entirely on-device.
      const redaction = await redactPiiLocally(fullTranscript, routingRef.current, nanoRef.current);
      const redactionLocal =
        redaction.meta.source !== 'CLOUD_GEMINI' && redaction.meta.source !== 'CLOUD_FALLBACK';

      applyTelemetry((previous) => {
        const merged = mergeTelemetry(
          previous,
          { data: null, meta: redaction.meta },
          redactionLocal ? 'local' : 'cloud',
          fullTranscript,
        );
        return {
          ...merged,
          piiEntitiesRedactedLocally: previous.piiEntitiesRedactedLocally + redaction.data.redactionCount,
        };
      });
      setRedactionCount(redaction.data.redactionCount);
      pushActivity(
        redaction.meta.source,
        'PII_GATE',
        `PII masked · ${redaction.data.redactionCount} entities`,
        redaction.meta.latencyMs,
      );

      if (!CAPTURE_MODE) await sleep(650);
      setPhase('cloud');

      // Step 2 — cloud synthesis, sanitized text only.
      const synthesis = await synthesizePostCallBrief(
        redaction.data.sanitizedTranscript,
        goalsRef.current,
        telemetryRef.current,
        {
          company: scenarioId === OPEN_CALL_ID ? 'Open Call' : scenario.company,
          contact: scenarioId === OPEN_CALL_ID ? 'Guest' : scenario.contact,
          role: scenarioId === OPEN_CALL_ID ? 'Freeform conversation' : scenario.role,
          rawTranscript: fullTranscript,
          redactionCount: redaction.data.redactionCount,
        },
      );

      recordCall(synthesis.meta.source, synthesis.meta.latencyMs, redaction.data.sanitizedTranscript);
      pushActivity(
        synthesis.meta.source,
        'SYNTHESIS',
        `Brief synthesized · ${Math.round(redaction.data.sanitizedTranscript.length / 4)} tokens in`,
        synthesis.meta.latencyMs,
      );

      const draft: PostCallBrief = {
        ...synthesis.data,
        telemetry: telemetryRef.current,
        syncStatus: 'SAVING',
      };
      setBrief(draft);
      setPhase('ready');

      const persisted = await saveSession(draft, authSession.uid);
      setSyncStatus(persisted);
      setBrief((previous) => (previous ? { ...previous, syncStatus: persisted } : previous));
      const updatedList = await listSessions(authSession.uid);
      setSavedCount(updatedList.length);
    } catch (synthesisError) {
      console.error('[PulseBrief] Post-call pipeline failed', synthesisError);
      setError('The synthesis pipeline failed. Check the console, then try again.');
      setModalOpen(false);
      setPhase('ready');
    } finally {
      synthBusyRef.current = false;
    }
  }, [applyTelemetry, authSession.uid, pushActivity, recordCall, scenario, scenarioId, stopAll]);

  const endCallRef = useRef(handleEndCall);
  endCallRef.current = handleEndCall;

  /* --- Goal editing ------------------------------------------------------ */

  const handleUpdateGoal = useCallback((goalId: string, text: string) => {
    setGoals((previous) => {
      const next = previous.map((goal) =>
        goal.id === goalId
          ? { ...goal, text, status: 'pending' as const, evidenceSnippet: undefined, updatedBy: undefined, latencyMs: undefined }
          : goal,
      );
      goalsRef.current = next;
      return next;
    });
  }, []);

  const handleAddGoal = useCallback(() => {
    if (goalsRef.current.length >= 5) return;
    const goal: SessionGoal = {
      id: makeId('goal'),
      text: 'New goal — click the edit icon',
      status: 'pending',
    };
    setGoals((previous) => {
      const next = [...previous, goal];
      goalsRef.current = next;
      return next;
    });
  }, []);

  const handleDeleteGoal = useCallback((goalId: string) => {
    setGoals((previous) => {
      const next = previous.filter((goal) => goal.id !== goalId);
      goalsRef.current = next;
      return next;
    });
  }, []);

  const handleToggleGoal = useCallback((goalId: string) => {
    setGoals((previous) => {
      const next = previous.map((goal) =>
        goal.id === goalId
          ? {
              ...goal,
              status: goal.status === 'covered' ? ('pending' as const) : ('covered' as const),
              evidenceSnippet: goal.status === 'covered' ? undefined : 'Manually marked covered by the interviewer.',
              updatedBy: goal.status === 'covered' ? undefined : ('LOCAL_NANO' as const),
            }
          : goal,
      );
      goalsRef.current = next;
      return next;
    });
  }, []);

  const handleResetGoals = useCallback(() => {
    const next = scenarioId === OPEN_CALL_ID ? [] : seedGoals(getScenario(scenarioId));
    goalsRef.current = next;
    setGoals(next);
  }, [scenarioId]);

  const handleScenarioChange = useCallback(
    (nextScenarioId: string) => {
      resetSession();
      setScenarioId(nextScenarioId);
      const next = nextScenarioId === OPEN_CALL_ID ? [] : seedGoals(getScenario(nextScenarioId));
      goalsRef.current = next;
      setGoals(next);
    },
    [resetSession],
  );

  const handleRoutingMode = useCallback((mode: RoutingMode) => {
    setRoutingMode(mode);
    routingRef.current = mode;
  }, []);

  const handleNudgeDismiss = useCallback((nudgeId: string) => {
    setNudges((previous) => previous.map((nudge) => (nudge.id === nudgeId ? { ...nudge, dismissed: true } : nudge)));
  }, []);

  const handleNudgeAsked = useCallback((nudgeId: string) => {
    setNudges((previous) => previous.map((nudge) => (nudge.id === nudgeId ? { ...nudge, asked: true } : nudge)));
  }, []);

  const handleBriefModalClose = useCallback(() => setModalOpen(false), []);
  const handleAccountModalClose = useCallback(() => {
    setAccountModalOpen(false);
    void listSessions(authSession.uid).then((items) => setSavedCount(items.length));
  }, [authSession.uid]);
  const handleAccountSessionChange = useCallback((nextSession: AuthSession) => {
    setAuthSession(nextSession);
    void listSessions(nextSession.uid).then((items) => setSavedCount(items.length));
  }, []);
  const handleOpenSavedBrief = useCallback((selectedBrief: PostCallBrief) => {
    setBrief(selectedBrief);
    setRedactionCount(selectedBrief.redactionCount);
    setSyncStatus(selectedBrief.syncStatus);
    setPhase('ready');
    setModalOpen(true);
  }, []);

  /* --- Judge deep links (?seed=1&brief=1) -------------------------------- */

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wantsSeed = params.get('seed') === '1' || params.get('demo') === '1';
    if (!wantsSeed || seededRef.current) return;
    seededRef.current = true;

    const demoScenario = getScenario(INITIAL_SCENARIO_ID);
    const demoGoals = seedGoals(demoScenario);
    goalsRef.current = demoGoals;
    setGoals(demoGoals);

    const now = Date.now();
    const seededSegments: TranscriptSegment[] = demoScenario.lines.map((line, index) => ({
      id: `seed_${index}`,
      speaker: line.speaker,
      text: line.text,
      timestamp: new Date(now - (demoScenario.lines.length - index) * 11000).toISOString(),
      isFinal: true,
      containsPii: hasPii(line.text),
    }));

    segmentsRef.current = seededSegments;
    setSegments(seededSegments);
    turnCountRef.current = Math.max(1, seededSegments.length - 1);
    setElapsed(seededSegments.length * 11);

    if (CAPTURE_MODE && params.get('brief') === '1') {
      window.setTimeout(() => {
        void endCallRef.current();
      }, 1400);
    }

    void (async () => {
      await analyzeTranscript();

      // Replay the hedged turn from the middle of the call so the co-pilot feed
      // is populated exactly as it would have been mid-conversation.
      const hedgeWindow = demoScenario.lines
        .slice(0, 10)
        .map((line) => `${line.speaker}: ${line.text}`)
        .join('\n');
      const nudgeResult = await generateLiveFollowUpNudge(
        hedgeWindow,
        goalsRef.current,
        routingRef.current,
        nanoRef.current,
        9,
      );
      const nudge = nudgeFromDraft(nudgeResult.data, nudgeResult.meta);
      if (nudge) {
        setNudges((previous) =>
          previous.some((entry) => entry.suggestedQuestion === nudge.suggestedQuestion)
            ? previous
            : [nudge, ...previous],
        );
        pushActivity(
          nudgeResult.meta.source,
          'NUDGE',
          `Follow-up · ${nudge.triggerType.replace(/_/g, ' ').toLowerCase()}`,
          nudgeResult.meta.latencyMs,
        );
        recordCall(nudgeResult.meta.source, nudgeResult.meta.latencyMs, hedgeWindow);
      }

      if (!CAPTURE_MODE && params.get('brief') === '1') {
        window.setTimeout(() => {
          void endCallRef.current();
        }, 500);
      }
    })();
  }, [analyzeTranscript, pushActivity, recordCall]);

  useEffect(() => () => stopAll(), [stopAll]);

  const coveredCount = goals.filter((goal) => goal.status === 'covered').length;
  const activeNudgeCount = nudges.filter((nudge) => !nudge.dismissed).length;
  const demoMode = isDemoEngine;
  const localActive = demoMode || routingMode === 'FORCE_LOCAL' || !online || (routingMode === 'AUTO_HYBRID' && nano === 'AVAILABLE');
  const micSupported = isLiveMicSupported();
  const scriptedSeconds = scenarioDurationSeconds(scenario, speed);

  return (
    <div className={styles.shell}>
      <TopBar
        routingMode={routingMode}
        onRoutingModeChange={handleRoutingMode}
        telemetry={telemetry}
        nanoStatus={nano}
        online={online}
        simulated={demoMode}
        cloudReady={isCloudReady()}
        theme={theme}
        onToggleTheme={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
        authSession={authSession}
        savedCount={savedCount}
        onOpenHistory={() => {
          setAccountModalTab('history');
          setAccountModalOpen(true);
        }}
        onOpenAccount={() => {
          setAccountModalTab('account');
          setAccountModalOpen(true);
        }}
      />

      <RuntimeStatusBanner
        online={online}
        nanoStatus={nano}
        nanoDetail={nanoDetail}
        routingMode={routingMode}
        simulated={demoMode}
        onRetryCheck={refreshNanoStatus}
        onSwitchToCloud={() => handleRoutingMode('AUTO_HYBRID')}
        dismissedKey={dismissedBanner}
        onDismiss={(key) => setDismissedBanner(key)}
      />

      <nav className={styles.mobileNav} aria-label="Workspace views">
        <button
          type="button"
          className={`${styles.mobileTab} ${mobilePane === 'transcript' ? styles.mobileTabActive : ''}`}
          aria-pressed={mobilePane === 'transcript'}
          onClick={() => setMobilePane('transcript')}
        >
          <span>Transcript</span>
          {segments.length > 0 && <span className={styles.mobileBadge}>{segments.length}</span>}
        </button>
        <button
          type="button"
          className={`${styles.mobileTab} ${mobilePane === 'goals' ? styles.mobileTabActive : ''}`}
          aria-pressed={mobilePane === 'goals'}
          onClick={() => setMobilePane('goals')}
        >
          <span>Goals</span>
          <span className={styles.mobileBadge}>
            {coveredCount}/{goals.length}
          </span>
        </button>
        <button
          type="button"
          className={`${styles.mobileTab} ${mobilePane === 'copilot' ? styles.mobileTabActive : ''}`}
          aria-pressed={mobilePane === 'copilot'}
          onClick={() => setMobilePane('copilot')}
        >
          <span>Co-pilot</span>
          {activeNudgeCount > 0 && <span className={styles.mobileBadge}>{activeNudgeCount}</span>}
        </button>
      </nav>

      <main className={`${styles.workspace} ${mobilePane === 'copilot' ? styles.compactCombined : ''}`}>
        <div className={`${styles.panelSlot} ${mobilePane !== 'goals' ? styles.panelHiddenMobile : ''}`}>
          <GoalSidebar
            goals={goals}
            scenarioId={scenarioId}
            onScenarioChange={handleScenarioChange}
            onUpdateGoal={handleUpdateGoal}
            onAddGoal={handleAddGoal}
            onDeleteGoal={handleDeleteGoal}
            onReset={handleResetGoals}
            onToggleGoal={handleToggleGoal}
          />
        </div>

        <div className={`${styles.panelSlot} ${mobilePane !== 'transcript' ? styles.panelHiddenMobile : ''}`}>
          <LiveTranscript
            segments={segments}
            interim={interim}
            onStartMic={startMic}
            onStopMic={stopMic}
            onStartTabAudio={startTabAudio}
            onStopTabAudio={stopTabAudio}
            tabMode={tabMode}
            audioLevels={audioLevels}
            speakerMode={manualSpeaker}
            onCycleSpeakerMode={cycleSpeakerMode}
            onFlipSpeaker={flipSegmentSpeaker}
            onSimulate={startSimulation}
            onStopSimulation={stopSimulation}
            onEndCall={handleEndCall}
            onSpeedChange={handleSpeedChange}
            speed={speed}
            listening={listening}
            simulating={simulating}
            micSupported={micSupported}
            canSynthesize={segments.length > 0}
            synthesizing={phase === 'redacting' || phase === 'cloud'}
            elapsedLabel={formatElapsed(elapsed)}
            sessionTitle={scenarioId === OPEN_CALL_ID ? 'Open / Freeform Call' : scenario.company}
            sessionMeta={scenarioId === OPEN_CALL_ID ? 'No preset goals' : `${scenario.contact} · ${scenario.role}`}
            scriptedSeconds={scriptedSeconds}
            error={error}
            onDismissError={() => setError(null)}
            extensionOrigin={isExtensionOrigin}
            enableMicPrompt={enableMicPrompt}
            onEnableMic={openMicGrant}
            micGrantNotice={micGrantNotice}
          />
        </div>

        <div className={`${styles.panelSlot} ${mobilePane !== 'copilot' ? styles.panelHiddenMobile : ''}`}>
          <CoPilotFeed
            nudges={nudges}
            activity={activity}
            onDismiss={handleNudgeDismiss}
            onMarkAsked={handleNudgeAsked}
            active={listening || simulating}
            localActive={localActive}
            goals={goals}
            onDock={() => setMobilePane('copilot')}
          />
        </div>
      </main>

      <PostCallBriefModal
        open={modalOpen}
        phase={phase}
        brief={brief}
        redactionCount={redactionCount}
        syncStatus={syncStatus}
        onClose={handleBriefModalClose}
      />

      <AccountAndHistoryModal
        open={accountModalOpen}
        initialTab={accountModalTab}
        session={authSession}
        onSessionChange={handleAccountSessionChange}
        onOpenBrief={handleOpenSavedBrief}
        onClose={handleAccountModalClose}
      />

      <p className={styles.bootNote} aria-hidden="true">
        booted {new Date(bootedAtRef.current).toLocaleDateString('en-US')} · engine {demoMode ? 'local-sim' : 'firebase-ai'}
      </p>
    </div>
  );
}
