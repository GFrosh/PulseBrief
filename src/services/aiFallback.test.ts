import { describe, expect, it, vi } from 'vitest';
import {
  PROVIDER_DOWN_MS,
  RATE_LIMITED_MS,
  callWithFallback,
  classifyAiError,
  createProviderBreaker,
} from './aiFallback';

const firebaseError = (status: number, message = 'something happened', code = 'fetch-error') =>
  Object.assign(new Error(`AI: Error fetching from the API: [${status} ] ${message} (ai/${code})`), {
    code: `ai/${code}`,
    customErrorData: { status },
  });

describe('classifyAiError', () => {
  it.each([
    [403, 'The caller does not have permission'],
    [404, 'Requested entity was not found'],
    [401, 'Request had invalid authentication credentials'],
  ])('treats a %i from the project as the project being unavailable', (status, message) => {
    expect(classifyAiError(firebaseError(status, message))).toBe('provider-down');
  });

  it('treats a rejected API key as the project being unavailable', () => {
    expect(classifyAiError(firebaseError(400, 'API key not valid. Please pass a valid API key.'))).toBe(
      'provider-down',
    );
  });

  it('treats a disabled API, billing problem or App Check problem as unavailable', () => {
    expect(classifyAiError(new Error('AI: The Gemini API has not been enabled (ai/api-not-enabled)'))).toBe(
      'provider-down',
    );
    expect(classifyAiError(new Error('Billing account is closed'))).toBe('provider-down');
    expect(classifyAiError(new Error('App Check token is invalid'))).toBe('provider-down');
  });

  it('treats too many requests as rate limited', () => {
    expect(classifyAiError(firebaseError(429, 'Resource has been exhausted'))).toBe('rate-limited');
    expect(classifyAiError(new Error('RESOURCE_EXHAUSTED: quota exceeded'))).toBe('rate-limited');
  });

  it('does not blame the project for server hiccups or odd errors', () => {
    expect(classifyAiError(firebaseError(500, 'Internal error'))).toBe('other');
    expect(classifyAiError(firebaseError(503, 'The model is overloaded'))).toBe('other');
    expect(classifyAiError(new TypeError('Failed to fetch'))).toBe('other');
    expect(classifyAiError(null)).toBe('other');
    expect(classifyAiError('nope')).toBe('other');
  });
});

describe('createProviderBreaker', () => {
  it('stays down until the time is up, then lets the primary try again', () => {
    let now = 1_000;
    const breaker = createProviderBreaker(() => now);
    expect(breaker.isDown()).toBe(false);

    breaker.trip(5_000);
    expect(breaker.isDown()).toBe(true);
    now += 4_999;
    expect(breaker.isDown()).toBe(true);
    now += 2;
    expect(breaker.isDown()).toBe(false);
  });

  it('never shortens a longer wait', () => {
    let now = 0;
    const breaker = createProviderBreaker(() => now);
    breaker.trip(10_000);
    breaker.trip(1_000);
    now = 5_000;
    expect(breaker.isDown()).toBe(true);
  });

  it('can be reset', () => {
    const breaker = createProviderBreaker(() => 0);
    breaker.trip(10_000);
    breaker.reset();
    expect(breaker.isDown()).toBe(false);
  });
});

describe('callWithFallback', () => {
  const setup = () => {
    let now = 0;
    return {
      breaker: createProviderBreaker(() => now),
      advance: (ms: number) => {
        now += ms;
      },
    };
  };

  it('uses the primary project when it works', async () => {
    const { breaker } = setup();
    const primary = vi.fn().mockResolvedValue('from primary');
    const fallback = vi.fn().mockResolvedValue('from fallback');

    const out = await callWithFallback({ primary, fallback, breaker });

    expect(out).toEqual({ value: 'from primary', provider: 'primary' });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('goes straight to the fallback when there is no primary project', async () => {
    const { breaker } = setup();
    const fallback = vi.fn().mockResolvedValue('from fallback');

    const out = await callWithFallback({ primary: null, fallback, breaker });

    expect(out).toEqual({ value: 'from fallback', provider: 'fallback' });
  });

  it('answers the same call from the fallback when the primary is unavailable', async () => {
    const { breaker } = setup();
    const primary = vi.fn().mockRejectedValue(firebaseError(403, 'The caller does not have permission'));
    const fallback = vi.fn().mockResolvedValue('from fallback');
    const onSwitch = vi.fn();

    const out = await callWithFallback({ primary, fallback, breaker, onSwitch });

    expect(out).toEqual({ value: 'from fallback', provider: 'fallback' });
    expect(onSwitch).toHaveBeenCalledWith('provider-down', expect.any(Error));
    expect(breaker.isDown()).toBe(true);
  });

  it('skips the primary while it is marked down, then tries it again later', async () => {
    const { breaker, advance } = setup();
    const primary = vi
      .fn()
      .mockRejectedValueOnce(firebaseError(404, 'Project not found'))
      .mockResolvedValue('from primary');
    const fallback = vi.fn().mockResolvedValue('from fallback');

    await callWithFallback({ primary, fallback, breaker });
    expect(primary).toHaveBeenCalledTimes(1);

    // Still inside the wait: the primary is not even tried.
    await callWithFallback({ primary, fallback, breaker });
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(2);

    advance(PROVIDER_DOWN_MS + 1);
    const out = await callWithFallback({ primary, fallback, breaker });
    expect(out.provider).toBe('primary');
    expect(primary).toHaveBeenCalledTimes(2);
  });

  it('waits a shorter time after a rate limit', async () => {
    const { breaker, advance } = setup();
    const primary = vi.fn().mockRejectedValue(firebaseError(429, 'Resource has been exhausted'));
    const fallback = vi.fn().mockResolvedValue('from fallback');

    await callWithFallback({ primary, fallback, breaker });
    expect(breaker.isDown()).toBe(true);
    advance(RATE_LIMITED_MS + 1);
    expect(breaker.isDown()).toBe(false);
  });

  it('retries on the fallback after an unclear error but does not mark the primary down', async () => {
    const { breaker } = setup();
    const primary = vi.fn().mockRejectedValue(firebaseError(500, 'Internal error'));
    const fallback = vi.fn().mockResolvedValue('from fallback');

    const out = await callWithFallback({ primary, fallback, breaker, isOffline: () => false });

    expect(out.provider).toBe('fallback');
    expect(breaker.isDown()).toBe(false);
  });

  it('does not switch projects when the browser is offline', async () => {
    const { breaker } = setup();
    const failure = new TypeError('Failed to fetch');
    const primary = vi.fn().mockRejectedValue(failure);
    const fallback = vi.fn().mockResolvedValue('from fallback');

    await expect(callWithFallback({ primary, fallback, breaker, isOffline: () => true })).rejects.toBe(failure);
    expect(fallback).not.toHaveBeenCalled();
    expect(breaker.isDown()).toBe(false);
  });

  it('passes the error on when the fallback fails too', async () => {
    const { breaker } = setup();
    const primary = vi.fn().mockRejectedValue(firebaseError(403));
    const failure = new Error('fallback is down as well');
    const fallback = vi.fn().mockRejectedValue(failure);

    await expect(callWithFallback({ primary, fallback, breaker })).rejects.toBe(failure);
  });
});
