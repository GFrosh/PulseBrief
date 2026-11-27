import type { InferenceTelemetry, NanoAvailability, RoutingMode } from '../../types/session';
import type { AuthSession } from '../../config/firebase';
import { averageLocalLatency } from '../../services/hybridAI';
import styles from './TopBar.module.css';

interface TopBarProps {
  routingMode: RoutingMode;
  onRoutingModeChange: (mode: RoutingMode) => void;
  telemetry: InferenceTelemetry;
  nanoStatus: NanoAvailability;
  online: boolean;
  simulated: boolean;
  cloudReady: boolean;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  authSession: AuthSession;
  savedCount: number;
  onOpenHistory: () => void;
  onOpenAccount: () => void;
}

const ROUTING_OPTIONS: Array<{ value: RoutingMode; label: string; short: string }> = [
  { value: 'AUTO_HYBRID', label: 'Auto Hybrid', short: 'Auto' },
  { value: 'FORCE_LOCAL', label: 'Force Local', short: 'Local' },
  { value: 'FORCE_CLOUD', label: 'Force Cloud', short: 'Cloud' },
];

type PillTone = 'local' | 'cloud' | 'offline' | 'demo' | 'pending';

function resolvePill(
  online: boolean,
  routingMode: RoutingMode,
  nanoStatus: NanoAvailability,
  simulated: boolean,
): { tone: PillTone; label: string; detail: string } {
  const realNanoReady = !simulated && nanoStatus === 'AVAILABLE';

  if (!online) {
    return {
      tone: 'offline',
      label: routingMode === 'FORCE_CLOUD' ? 'Cloud unavailable offline' : realNanoReady ? 'Local Nano active offline' : 'Offline Mode',
      detail: routingMode === 'FORCE_CLOUD'
        ? 'Cloud-routed analysis cannot reach Gemini; the app falls back locally and queues Firestore writes until reconnect.'
        : 'Network lost. Live inference falls back on this device when available; Firestore writes queue until reconnect.',
    };
  }
  if (routingMode === 'FORCE_CLOUD') {
    return {
      tone: 'cloud',
      label: simulated ? 'Simulated Cloud Mode' : 'Cloud Forced: Gemini 3.8 flash',
      detail: 'Live analysis and final synthesis route to Cloud Gemini. The PII privacy gate always stays on-device.',
    };
  }
  if (routingMode === 'FORCE_LOCAL') {
    if (realNanoReady) {
      return {
        tone: 'local',
        label: 'On-Device Forced: Gemini Nano',
        detail: 'Only the on-device model may answer. Cloud calls are disabled.',
      };
    }
    if (simulated) {
      return {
        tone: 'demo',
        label: 'Simulated Local Mode',
        detail: 'Running local demo engine with cloud calls disabled.',
      };
    }
    return {
      tone: 'pending',
      label: 'Local Forced — Nano unavailable',
      detail: 'On-device Gemini Nano is not ready on this machine. Switch to Auto Hybrid for cloud fallback.',
    };
  }
  if (realNanoReady) {
    return {
      tone: 'local',
      label: 'On-Device: Gemini Nano Active',
      detail: 'Real Gemini Nano is running in Chrome for goal tracking, nudges, and PII masking.',
    };
  }
  if (nanoStatus === 'DOWNLOADING') {
    return {
      tone: 'pending',
      label: 'Nano downloading — Cloud fallback',
      detail: 'Gemini Nano is still downloading. Requests fall back to Cloud Gemini.',
    };
  }
  if (simulated) {
    return {
      tone: 'demo',
      label: 'Demo Engine — simulated',
      detail: 'Demo engine active. Connect Firebase AI Logic + Chrome Gemini Nano for live inference.',
    };
  }
  return {
    tone: 'cloud',
    label: 'Cloud Fallback: Gemini 3.8 Flash',
    detail: 'On-device model unavailable on this computer. Requests route to Cloud Gemini.',
  };
}

export default function TopBar({
  routingMode,
  onRoutingModeChange,
  telemetry,
  nanoStatus,
  online,
  simulated,
  cloudReady,
  theme,
  onToggleTheme,
  authSession,
  savedCount,
  onOpenHistory,
  onOpenAccount,
}: TopBarProps) {
  const pill = resolvePill(online, routingMode, nanoStatus, simulated);
  const avgLocal = averageLocalLatency(telemetry.localLatenciesMs);
  const isSignedIn = !authSession.isAnonymous;

  return (
    <header className={styles.topbar}>
      <div className={styles.brand}>
        <div className={styles.mark} aria-hidden="true">
          <svg viewBox="0 0 32 32" width="28" height="28">
            <defs>
              <linearGradient id="pbMark" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="55%" stopColor="#22d3ee" />
                <stop offset="100%" stopColor="#818cf8" />
              </linearGradient>
            </defs>
            <rect x="0.5" y="0.5" width="31" height="31" rx="9" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.12)" />
            <path
              d="M5 18h4.4l2.1-6 3.5 12 2.6-8.4 1.8 4.2h3.3"
              fill="none"
              stroke="url(#pbMark)"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className={styles.brandText}>
          <div className={styles.wordmarkRow}>
            <span className={styles.wordmark}>PulseBrief</span>
            <span className={styles.beta}>HYBRID</span>
          </div>
          <span className={styles.tagline}>Hybrid AI call co-pilot</span>
        </div>
      </div>

      <div className={styles.center}>
        <div className={styles.segmented} role="group" aria-label="Inference routing mode">
          {ROUTING_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`${styles.segment} ${routingMode === option.value ? styles.segmentActive : ''}`}
              aria-pressed={routingMode === option.value}
              onClick={() => onRoutingModeChange(option.value)}
              title={`Route inference: ${option.label}`}
            >
              <span className={styles.segmentFull}>{option.label}</span>
              <span className={styles.segmentShort}>{option.short}</span>
            </button>
          ))}
          <span className={styles.segmentGlow} data-mode={routingMode} aria-hidden="true" />
        </div>
      </div>

      <div className={styles.right}>
        <div className={`${styles.pill} ${styles[pill.tone]}`} title={pill.detail}>
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.pillLabel}>{pill.label}</span>
        </div>

        <div className={styles.telemetry} aria-label="Inference telemetry">
          <span className={styles.telemetryGroup} title="On-device inference calls">
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path d="M9.2 1 3.5 9h3.1L6 15l6.2-8.4H8.6L9.2 1Z" fill="currentColor" />
            </svg>
            <span className={styles.telemetryValue}>{telemetry.localNanoCalls}</span>
            <span className={styles.telemetryUnit}>
              local{telemetry.localNanoCalls > 0 ? ` · ${avgLocal}ms` : ''}
            </span>
          </span>
          <span className={styles.telemetryDivider} aria-hidden="true" />
          <span className={styles.telemetryGroup} title="Cloud inference calls">
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path
                d="M4.5 12.5h7a2.5 2.5 0 0 0 .4-4.97 4 4 0 0 0-7.7-1.2A2.9 2.9 0 0 0 4.5 12.5Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
            <span className={styles.telemetryValue}>{telemetry.cloudGeminiCalls}</span>
            <span className={styles.telemetryUnit}>cloud</span>
          </span>
        </div>

        <button
          type="button"
          className={styles.navAction}
          onClick={onOpenHistory}
          title="View saved call briefs"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M3 4.5h10M3 8h10M3 11.5h6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span className={styles.navActionLabel}>Saved</span>
          {savedCount > 0 && <span className={styles.navBadge}>{savedCount}</span>}
        </button>

        <button
          type="button"
          className={`${styles.navAction} ${isSignedIn ? styles.navActionSignedIn : ''}`}
          onClick={onOpenAccount}
          title={isSignedIn ? `Signed in as ${authSession.email ?? authSession.displayName}` : 'Sign in to sync your saved calls'}
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <circle cx="8" cy="5.5" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <path d="M3.2 13.4a4.8 4.8 0 0 1 9.6 0" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <span className={styles.navActionLabel}>{isSignedIn ? authSession.displayName : 'Sign in'}</span>
        </button>

        <button
          type="button"
          className={styles.iconButton}
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? (
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <circle cx="10" cy="10" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M10 2.2v1.7M10 16.1v1.7M2.2 10h1.7M16.1 10h1.7M4.5 4.5l1.2 1.2M14.3 14.3l1.2 1.2M15.5 4.5l-1.2 1.2M5.7 14.3l-1.2 1.2"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path
                d="M16.2 12.4A6.8 6.8 0 0 1 7.6 3.8a6.8 6.8 0 1 0 8.6 8.6Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>

      {!cloudReady && !simulated && (
        <span className={styles.configHint} title="No Firebase project is configured">
          local-only
        </span>
      )}
    </header>
  );
}
