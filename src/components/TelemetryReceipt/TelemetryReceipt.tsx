import type { InferenceTelemetry, InferenceSource, SyncStatus } from '../../types/session';
import { syncStatusLabel } from '../../services/sessionStore';
import { averageLocalLatency, estimateTokens } from '../../services/hybridAI';
import { firebaseMeta } from '../../config/firebase';
import styles from './TelemetryReceipt.module.css';

interface TelemetryReceiptProps {
  telemetry: InferenceTelemetry;
  redactionCount: number;
  syncStatus: SyncStatus;
  cloudLatencyMs: number;
  engine: InferenceSource;
  transcript: string;
}

function SyncIcon({ status }: { status: SyncStatus }) {
  if (status === 'SYNCED') {
    return (
      <svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">
        <path d="M2.4 7.4 5.4 10.4 11.6 3.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === 'QUEUED_OFFLINE') {
    return (
      <svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">
        <path d="M7 2.4v5l3 1.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="7" cy="7" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">
      <rect x="2.4" y="3" width="9.2" height="8.4" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.4 5.8h9.2M5 7.6h2.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export default function TelemetryReceipt({
  telemetry,
  redactionCount,
  syncStatus,
  cloudLatencyMs,
  engine,
  transcript,
}: TelemetryReceiptProps) {
  const avgLocal = averageLocalLatency(telemetry.localLatenciesMs);
  const localPct = telemetry.localNanoCalls + telemetry.cloudGeminiCalls > 0
    ? Math.round((telemetry.localNanoCalls / (telemetry.localNanoCalls + telemetry.cloudGeminiCalls)) * 100)
    : 0;
  const tokensKept = telemetry.estimatedTokensSavedLocally || estimateTokens(transcript);

  return (
    <section className={styles.receipt} aria-label="Inference telemetry receipt">
      <header className={styles.head}>
        <div className={styles.headLeft}>
          <span className={styles.logo} aria-hidden="true">
            <svg viewBox="0 0 16 16" width="13" height="13">
              <path d="M1.8 8.6h2.6l1.3-3.4 2 6.6 1.6-4.8 1 2.4h3.9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h3 className={styles.title}>Telemetry receipt</h3>
            <p className={styles.subtitle}>Proof of where every token was processed</p>
          </div>
        </div>
        <span className={`${styles.sync} ${styles[`sync_${syncStatus}`]}`}>
          <SyncIcon status={syncStatus} />
          {syncStatusLabel[syncStatus]}
        </span>
      </header>

      <div className={styles.splitBar} aria-hidden="true">
        <span className={styles.splitLocal} style={{ width: `${Math.max(4, localPct)}%` }} />
        <span className={styles.splitCloud} style={{ width: `${Math.max(4, 100 - localPct)}%` }} />
      </div>
      <div className={styles.splitLegend}>
        <span>
          <i className={styles.legendLocal} />
          On-device {localPct}%
        </span>
        <span>
          <i className={styles.legendCloud} />
          Cloud {100 - localPct}%
        </span>
      </div>

      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt>Local Nano calls</dt>
          <dd>
            <strong>{telemetry.localNanoCalls}</strong>
            <span className={styles.muted}> · {avgLocal}ms avg</span>
          </dd>
        </div>
        <div className={styles.row}>
          <dt>Longest local call</dt>
          <dd>
            <strong>{telemetry.localLatenciesMs.length ? Math.max(...telemetry.localLatenciesMs) : 0}ms</strong>
            <span className={styles.muted}> · budget 500ms</span>
          </dd>
        </div>
        <div className={styles.row}>
          <dt>Cloud Gemini calls</dt>
          <dd>
            <strong>{telemetry.cloudGeminiCalls}</strong>
            <span className={styles.muted}> · {cloudLatencyMs || 0}ms synthesis</span>
          </dd>
        </div>
        <div className={`${styles.row} ${styles.rowAmber}`}>
          <dt>PII masked before upload</dt>
          <dd>
            <strong>{redactionCount}</strong>
            <span className={styles.muted}> entities → [REDACTED_*]</span>
          </dd>
        </div>
        <div className={styles.row}>
          <dt>Tokens never sent to cloud raw</dt>
          <dd>
            <strong>{tokensKept.toLocaleString('en-US')}</strong>
            <span className={styles.muted}> est.</span>
          </dd>
        </div>
        <div className={styles.row}>
          <dt>Final synthesis engine</dt>
          <dd className={styles.mono}>{engine}</dd>
        </div>
      </dl>

      <footer className={styles.foot}>
        <span>Firebase AI Logic</span>
        <span className={styles.footDivider} />
        <span>App Check {firebaseMeta.appCheck ? 'enforced' : 'unavailable'}</span>
        <span className={styles.footDivider} />
        <span>Auth {firebaseMeta.authMode}</span>
        <span className={styles.footDivider} />
        <span>{firebaseMeta.firestore}</span>
      </footer>
    </section>
  );
}
