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
  start: () => void;
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

  constructor(callbacks: TranscriptCallbacks) {
    this.callbacks = callbacks;
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
      this.callbacks.onListeningChange?.(true);
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0]?.transcript?.trim() ?? '';
        if (!text) continue;
        if (result.isFinal) {
          this.callbacks.onFinal('You (Interviewer)', text);
        } else {
          interim += `${text} `;
        }
      }
      this.callbacks.onInterim('You (Interviewer)', interim.trim());
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
        this.callbacks.onListeningChange?.(false);
      }
    };

    recognition.onend = () => {
      this.callbacks.onListeningChange?.(false);
      if (this.shouldListen && navigator.onLine) {
        this.restartTimer = window.setTimeout(() => {
          try {
            recognition.start();
          } catch {
            /* start() throws if the engine is already starting — safe to ignore */
          }
        }, 240);
      }
    };

    this.recognition = recognition;
    this.shouldListen = true;

    try {
      recognition.start();
      return true;
    } catch (error) {
      console.error('[PulseBrief] Could not start speech recognition', error);
      this.shouldListen = false;
      return false;
    }
  }

  stop(): void {
    this.shouldListen = false;
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

        onInterim(line.speaker, '');
        await sleep(Math.max(120, 420 / this.options.speed), signal);
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
