/**
 * Automatic fallback between two Firebase projects for cloud AI calls.
 *
 * The "primary" project is tried first. When it fails in a way that means the
 * project is unavailable (deleted, billing off, API key rejected, quota used up)
 * we switch to the "fallback" project for the same call, and we keep using the
 * fallback for a while so every call does not pay for a failed first try.
 *
 * This file has no Firebase imports so it can be tested on its own.
 */

export type ProviderErrorKind = 'provider-down' | 'rate-limited' | 'other';

/** How long to skip the primary project after it clearly failed. */
export const PROVIDER_DOWN_MS = 5 * 60 * 1000;
/** How long to skip the primary project after it said "too many requests". */
export const RATE_LIMITED_MS = 60 * 1000;

interface ErrorLike {
  code?: unknown;
  message?: unknown;
  status?: unknown;
  customErrorData?: { status?: unknown };
}

function statusOf(error: ErrorLike, text: string): number | null {
  const direct = Number(error.customErrorData?.status ?? error.status);
  if (Number.isInteger(direct) && direct >= 100 && direct < 600) return direct;
  // Firebase AI messages look like "... [403 ] The caller does not have permission".
  const fromText = /\[(\d{3})\b/.exec(text);
  return fromText ? Number(fromText[1]) : null;
}

/** Decide what a failed cloud call tells us about the project that served it. */
export function classifyAiError(error: unknown): ProviderErrorKind {
  const e = (error ?? {}) as ErrorLike;
  const text = `${String(e.code ?? '')} ${String(e.message ?? '')}`.toLowerCase();
  const status = statusOf(e, text);

  if (
    status === 429 ||
    /resource_exhausted|quota|rate limit|too many requests/.test(text)
  ) {
    return 'rate-limited';
  }

  if (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    /api-not-enabled|has not been enabled|has not been used|permission_denied|permission denied|api key not valid|api_key_invalid|invalid api key|api key expired|billing|app check|appcheck|project .*(not found|deleted|suspended)|consumer .*suspended|service_disabled/.test(
      text,
    )
  ) {
    return 'provider-down';
  }

  return 'other';
}

export interface ProviderBreaker {
  /** True while the primary project should be skipped. */
  isDown(): boolean;
  trip(ms: number): void;
  reset(): void;
}

export function createProviderBreaker(now: () => number = () => Date.now()): ProviderBreaker {
  let downUntil = 0;
  return {
    isDown: () => now() < downUntil,
    trip: (ms) => {
      downUntil = Math.max(downUntil, now() + ms);
    },
    reset: () => {
      downUntil = 0;
    },
  };
}

export interface FallbackOutcome<T> {
  value: T;
  provider: 'primary' | 'fallback';
}

interface FallbackOptions<T> {
  /** Call on the primary project, or null when there is none. */
  primary: (() => Promise<T>) | null;
  fallback: () => Promise<T>;
  breaker: ProviderBreaker;
  /** When the browser is offline, a failure says nothing about the project. */
  isOffline?: () => boolean;
  onSwitch?: (kind: ProviderErrorKind, error: unknown) => void;
}

export async function callWithFallback<T>(options: FallbackOptions<T>): Promise<FallbackOutcome<T>> {
  const { primary, fallback, breaker, isOffline, onSwitch } = options;

  if (primary && !breaker.isDown()) {
    try {
      return { value: await primary(), provider: 'primary' };
    } catch (error) {
      const kind = classifyAiError(error);
      if (kind === 'other' && isOffline?.()) throw error;
      if (kind === 'provider-down') breaker.trip(PROVIDER_DOWN_MS);
      if (kind === 'rate-limited') breaker.trip(RATE_LIMITED_MS);
      onSwitch?.(kind, error);
    }
  }

  return { value: await fallback(), provider: 'fallback' };
}
