import type { Scenario, Speaker } from '../types/session';

/* ==========================================================================
   Speech layer
   1. LiveMicRecorder  — real browser Web Speech API capture (Chrome / Edge)
   2. SimulatedCallStreamer — deterministic judge demo that streams a scripted
      conversation word-by-word into the same transcript buffer.
   Both expose identical callbacks, so the rest of the app cannot tell them apart.
   ========================================================================== */

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: (audioTrack?: MediaStreamTrack) => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const isLiveMicSupported = (): boolean => getSpeechRecognition() !== null;

export interface TranscriptCallbacks {
  onInterim: (speaker: Speaker, text: string) => void;
  onFinal: (speaker: Speaker, text: string) => void;
  onError?: (message: string) => void;
  onListeningChange?: (listening: boolean) => void;
}

/* --------------------------------------------------------------------------
   Live microphone capture
   -------------------------------------------------------------------------- */

export class LiveMicRecorder {
  private recognition: SpeechRecognitionLike | null = null;
  private shouldListen = false;
  private callbacks: TranscriptCallbacks;
  private restartTimer: number | null = null;
  private recognitionEnded = false;
  private onlineListener: (() => void) | null = null;
  private inputTrack: MediaStreamTrack | null;
  speakerResolver: (() => Speaker) | null = null;

  constructor(callbacks: TranscriptCallbacks, inputTrack: MediaStreamTrack | null = null) {
    this.callbacks = callbacks;
    this.inputTrack = inputTrack;
  }

  get supported(): boolean {
    return getSpeechRecognition() !== null;
  }

  start(): boolean {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      this.callbacks.onError?.(
        'This browser has no Web Speech API. Use Chrome or Edge, or run the simulated call.',
      );
      return false;
    }
    if (this.shouldListen) return true;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      this.recognitionEnded = false;
      this.callbacks.onListeningChange?.(true);
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript?.trim() ?? '';
        if (!text) continue;
        if (result.isFinal) {
          this.callbacks.onFinal(this.speakerResolver?.() ?? 'You (Interviewer)', text);
        } else {
          interim += `${text} `;
        }
      }
      this.callbacks.onInterim(this.speakerResolver?.() ?? 'You (Interviewer)', interim.trim());
    };

    recognition.onerror = (event) => {
      // `no-speech` and `aborted` are normal during silence — restart quietly.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      const messages: Record<string, string> = {
        'not-allowed': 'Microphone permission denied. Allow mic access, or use the simulated call.',
        'service-not-allowed': 'Speech service blocked by the browser. Try the simulated call.',
        network: 'Speech recognition lost its network connection. Retrying when you are back online.',
        'audio-capture': 'No microphone found. Plug one in, or use the simulated call.',
      };
      this.callbacks.onError?.(messages[event.error] ?? `Speech error: ${event.error}`);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.shouldListen = false;
        if (this.onlineListener) window.removeEventListener('online', this.onlineListener);
        this.onlineListener = null;
        this.callbacks.onListeningChange?.(false);
      }
    };

    recognition.onend = () => {
      this.recognitionEnded = true;
      this.callbacks.onListeningChange?.(false);
      this.scheduleRestart(recognition);
    };

    this.recognition = recognition;
    this.shouldListen = true;
    this.onlineListener = () => this.scheduleRestart(recognition);
    window.addEventListener('online', this.onlineListener);

    try {
      // Chromium accepts a MediaStreamTrack here. Without one, SpeechRecognition
      // silently falls back to the device microphone, which misses shared-tab audio.
      if (this.inputTrack) recognition.start(this.inputTrack);
      else recognition.start();
      return true;
    } catch (error) {
      console.error('[PulseBrief] Could not start speech recognition', error);
      this.shouldListen = false;
      if (this.onlineListener) window.removeEventListener('online', this.onlineListener);
      this.onlineListener = null;
      this.recognition = null;
      if (this.inputTrack) {
        this.callbacks.onError?.('This browser could not start speech recognition from shared tab audio. Update Chrome or Edge and try again.');
      }
      return false;
    }
  }

  stop(): void {
    this.shouldListen = false;
    if (this.onlineListener) window.removeEventListener('online', this.onlineListener);
    this.onlineListener = null;
    if (this.restartTimer) window.clearTimeout(this.restartTimer);
    this.restartTimer = null;
    try {
      this.recognition?.stop();
    } catch {
      /* already stopped */
    }
    this.recognition = null;
    this.callbacks.onListeningChange?.(false);
  }

  private scheduleRestart(recognition: SpeechRecognitionLike): void {
    if (!this.shouldListen || !this.recognitionEnded || !navigator.onLine) return;
    if (this.restartTimer !== null) window.clearTimeout(this.restartTimer);
    this.restartTimer = window.setTimeout(() => {
      this.restartTimer = null;
      if (!this.shouldListen || !navigator.onLine) return;
      try {
        if (this.inputTrack) recognition.start(this.inputTrack);
        else recognition.start();
      } catch {
        /* start() throws if the engine is already starting — safe to ignore */
      }
    }, 240);
  }
}

/** Captures shared tab audio and optional mic levels without recording audio. */
export class TabAudioCapture {
  private display: MediaStream | null = null;
  private mic: MediaStream | null = null;
  private context: AudioContext | null = null;
  private tabRecognitionTrack: MediaStreamTrack | null = null;
  private micRecognitionTrack: MediaStreamTrack | null = null;
  private timer = 0;
  micLevel = 0;
  tabLevel = 0;
  micDenied = false;
  private stopping = false;
  onLevels?: (mic: number, tab: number) => void;
  onEnded?: () => void;

  async start(): Promise<void> {
    this.stopping = false;
    this.display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (this.display.getAudioTracks().length === 0) {
      this.stop();
      throw new Error('The selected tab did not share audio. Select the meeting tab and enable “Share tab audio”.');
    }
    const videoTracks = this.display.getVideoTracks();
    videoTracks.forEach((track) => { track.onended = null; track.stop(); });
    this.display.getAudioTracks().forEach((track) => { track.onended = () => { if (!this.stopping) this.onEnded?.(); }; });
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch { this.micDenied = true; /* tab-only capture is valid */ }
    this.context = new AudioContext();
    await this.context.resume();
    const tabRecognitionDestination = this.context.createMediaStreamDestination();
    this.tabRecognitionTrack = tabRecognitionDestination.stream.getAudioTracks()[0] ?? null;
    const tabAnalyser = this.context.createAnalyser();
    tabAnalyser.fftSize = 512;
    const tabSource = this.context.createMediaStreamSource(this.display);
    tabSource.connect(tabAnalyser);
    tabSource.connect(tabRecognitionDestination);
    const micAnalyser = this.context.createAnalyser();
    micAnalyser.fftSize = 512;
    if (this.mic) {
      const micRecognitionDestination = this.context.createMediaStreamDestination();
      this.micRecognitionTrack = micRecognitionDestination.stream.getAudioTracks()[0] ?? null;
      const micSource = this.context.createMediaStreamSource(this.mic);
      micSource.connect(micAnalyser);
      micSource.connect(micRecognitionDestination);
    }
    const rms = (analyser: AnalyserNode, stream: MediaStream | null) => {
      if (!stream) return 0;
      const data = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      const sum = data.reduce((total, value) => total + ((value - 128) / 128) ** 2, 0);
      return Math.min(1, Math.sqrt(sum / data.length) * 3.2);
    };
    this.timer = window.setInterval(() => {
      const rawMic = rms(micAnalyser, this.mic);
      this.tabLevel = rms(tabAnalyser, this.display);
      this.micLevel = rawMic;
      this.onLevels?.(this.micLevel, this.tabLevel);
    }, 50);
  }

  get tabSpeechTrack(): MediaStreamTrack | null {
    return this.tabRecognitionTrack?.readyState === 'live' ? this.tabRecognitionTrack : null;
  }

  get microphoneSpeechTrack(): MediaStreamTrack | null {
    return this.micRecognitionTrack?.readyState === 'live' ? this.micRecognitionTrack : null;
  }

  stop(): void {
    this.stopping = true;
    window.clearInterval(this.timer);
    this.display?.getTracks().forEach((track) => track.stop());
    this.mic?.getTracks().forEach((track) => track.stop());
    this.display = null;
    this.mic = null;
    this.tabRecognitionTrack = null;
    this.micRecognitionTrack = null;
    void this.context?.close();
    this.context = null;
    this.micLevel = 0;
    this.tabLevel = 0;
    this.onLevels?.(0, 0);
  }
}

/* --------------------------------------------------------------------------
   Simulated call streamer
   -------------------------------------------------------------------------- */

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

export interface StreamerOptions extends TranscriptCallbacks {
  scenario: Scenario;
  /** 1 = natural conversational pace, 2.5 = demo pace. */
  speed: number;
  onLineStart?: (speaker: Speaker, text: string) => void;
  onComplete?: () => void;
}

export class SimulatedCallStreamer {
  private options: StreamerOptions;
  private controller: AbortController | null = null;
  private running = false;

  constructor(options: StreamerOptions) {
    this.options = options;
  }

  get isRunning(): boolean {
    return this.running;
  }

  setSpeed(speed: number): void {
    this.options.speed = speed;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.controller = new AbortController();
    void this.run(this.controller.signal);
  }

  stop(): void {
    this.running = false;
    this.controller?.abort();
    this.controller = null;
    this.options.onListeningChange?.(false);
  }

  private async run(signal: AbortSignal): Promise<void> {
    const { scenario, onInterim, onFinal, onLineStart } = this.options;
    this.options.onListeningChange?.(true);

    try {
      for (const line of scenario.lines) {
        await sleep(Math.max(260, line.gapMs / this.options.speed), signal);

        onLineStart?.(line.speaker, line.text);

        const words = line.text.split(/\s+/);
        const chunkSize = 2;
        const tick = Math.max(38, 118 / this.options.speed);

        for (let index = chunkSize; index <= words.length; index += chunkSize) {
          const partial = words.slice(0, index).join(' ');
          onInterim(line.speaker, partial);
          await sleep(tick, signal);
        }

        onFinal(line.speaker, line.text);
        await sleep(Math.max(160, 620 / this.options.speed), signal);
      }

      this.options.onComplete?.();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error('[PulseBrief] Simulated stream failed', error);
        this.options.onError?.('The simulated call stopped unexpectedly.');
      }
    } finally {
      this.running = false;
      this.options.onListeningChange?.(false);
    }
  }
}

/** Seconds of scripted conversation remaining at the given speed (for the UI). */
export function scenarioDurationSeconds(scenario: Scenario, speed: number): number {
  const speakingMs = scenario.lines.reduce((total, line) => {
    const words = line.text.split(/\s+/).length;
    return total + line.gapMs + words * 118 + 1040;
  }, 0);
  return Math.round(speakingMs / speed / 1000);
}
