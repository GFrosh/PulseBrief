import type { NanoAvailability, RoutingMode } from '../../types/session';
import styles from './RuntimeStatusBanner.module.css';

interface RuntimeStatusBannerProps {
  online: boolean;
  nanoStatus: NanoAvailability;
  nanoDetail: string;
  routingMode: RoutingMode;
  simulated: boolean;
  onRetryCheck: () => void;
  onSwitchToCloud: () => void;
  dismissedKey: string | null;
  onDismiss: (key: string) => void;
}

interface BannerSpec {
  key: string;
  tone: 'offline' | 'downloading' | 'unsupported';
  badge: string;
  title: string;
  description: string;
  showRetry?: boolean;
  showCloudAction?: boolean;
}

export default function RuntimeStatusBanner({
  online,
  nanoStatus,
  nanoDetail,
  routingMode,
  simulated,
  onRetryCheck,
  onSwitchToCloud,
  dismissedKey,
  onDismiss,
}: RuntimeStatusBannerProps) {
  let spec: BannerSpec | null = null;

  if (!online) {
    spec = {
      key: 'offline',
      tone: 'offline',
      badge: 'Offline',
      title: 'You are offline — running on-device mode',
      description:
        nanoStatus === 'AVAILABLE' || simulated
          ? 'Live goal tracking and nudges continue locally. Post-call briefs and Firestore sync will queue in IndexedDB until your connection returns.'
          : 'Network is unavailable and on-device Gemini Nano is not ready on this machine. Reconnect to resume cloud synthesis or live captions.',
      showRetry: true,
    };
  } else if (nanoStatus === 'DOWNLOADING') {
    spec = {
      key: 'nano-downloading',
      tone: 'downloading',
      badge: 'Model downloading',
      title: 'Gemini Nano is downloading in Chrome',
      description:
        nanoDetail ||
        'Chrome is downloading the on-device model (approx. 3–4 GB). PulseBrief automatically routes live requests to Cloud Gemini until the download completes.',
      showRetry: true,
    };
  } else if (nanoStatus === 'UNAVAILABLE') {
    spec = {
      key: 'nano-unsupported',
      tone: 'unsupported',
      badge: 'On-device unavailable',
      title: 'This computer cannot run the on-device Gemini Nano model',
      description: simulated
        ? 'Chrome Prompt API / Gemini Nano is unavailable here (requires Desktop Chrome 139+ with 16 GB RAM / >4 GB VRAM and ~22 GB free disk). Using the local demo engine, with Cloud Gemini as fallback when configured.'
        : 'Chrome Prompt API / Gemini Nano is unavailable on this device (requires Desktop Chrome 139+ with 16 GB RAM / >4 GB VRAM). Cloud Gemini is automatically used instead.',
      showRetry: true,
      showCloudAction: routingMode === 'FORCE_LOCAL',
    };
  }

  if (!spec || dismissedKey === spec.key) return null;

  return (
    <div className={`${styles.banner} ${styles[spec.tone]}`} role="status" aria-live="polite">
      <div className={styles.left}>
        <span className={styles.badge}>
          <span className={styles.dot} aria-hidden="true" />
          {spec.badge}
        </span>
        <div className={styles.copy}>
          <strong className={styles.title}>{spec.title}</strong>
          <span className={styles.desc}>{spec.description}</span>
        </div>
      </div>

      <div className={styles.actions}>
        {spec.showCloudAction && (
          <button type="button" className={styles.primaryBtn} onClick={onSwitchToCloud}>
            Use Auto Hybrid
          </button>
        )}
        {spec.showRetry && (
          <button type="button" className={styles.secondaryBtn} onClick={onRetryCheck}>
            Re-check
          </button>
        )}
        <button
          type="button"
          className={styles.dismissBtn}
          onClick={() => onDismiss(spec.key)}
          aria-label="Dismiss status notice"
          title="Dismiss"
        >
          <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
