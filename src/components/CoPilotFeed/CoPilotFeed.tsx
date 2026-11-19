import { useEffect, useRef, useState } from 'react';
import type { ActivityEntry, CoPilotNudge, NudgeTrigger } from '../../types/session';
import styles from './CoPilotFeed.module.css';

interface CoPilotFeedProps {
  nudges: CoPilotNudge[];
  activity: ActivityEntry[];
  onDismiss: (nudgeId: string) => void;
  onMarkAsked: (nudgeId: string) => void;
  active: boolean;
  localActive: boolean;
}

const TRIGGER_COPY: Record<NudgeTrigger, { label: string; tone: string }> = {
  VAGUE_ANSWER: { label: 'Vague answer detected', tone: 'warn' },
  UNANSWERED_QUESTION: { label: 'Unanswered question', tone: 'ask' },
  FOLLOW_UP_OPPORTUNITY: { label: 'Dig deeper', tone: 'dig' },
};

function TriggerIcon({ trigger }: { trigger: NudgeTrigger }) {
  if (trigger === 'VAGUE_ANSWER') {
    return (
      <svg viewBox="0 0 14 14" width="10" height="10" aria-hidden="true">
        <path d="M7 1.8 12.6 11.4H1.4L7 1.8Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M7 5.6v2.6M7 9.8v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    );
  }
  if (trigger === 'UNANSWERED_QUESTION') {
    return (
      <svg viewBox="0 0 14 14" width="10" height="10" aria-hidden="true">
        <circle cx="6.2" cy="6.2" r="4.1" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M9.4 9.4 12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 14 14" width="10" height="10" aria-hidden="true">
      <path d="M2 11.5 6 7.6l2.2 2.1L12 5.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 5.8h3v3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SourceDot({ source }: { source: ActivityEntry['source'] }) {
  const tone = source === 'CLOUD_GEMINI' ? 'cloud' : source === 'CLOUD_FALLBACK' ? 'amber' : 'local';
  return <span className={`${styles.logDot} ${styles[`dot_${tone}`]}`} aria-hidden="true" />;
}

function NudgeCard({
  nudge,
  onDismiss,
  onMarkAsked,
}: {
  nudge: CoPilotNudge;
  onDismiss: (id: string) => void;
  onMarkAsked: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  const trigger = TRIGGER_COPY[nudge.triggerType];

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(nudge.suggestedQuestion);
    } catch {
      const area = document.createElement('textarea');
      area.value = nudge.suggestedQuestion;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
    setCopied(true);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  const timestamp = new Date(nudge.timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  return (
    <article className={`${styles.card} ${nudge.asked ? styles.cardAsked : ''}`}>
      <div className={styles.cardTop}>
        <span className={`${styles.trigger} ${styles[`trigger_${trigger.tone}`]}`}>
          <TriggerIcon trigger={nudge.triggerType} />
          {trigger.label}
        </span>
        <span className={styles.cardTime}>{timestamp}</span>
      </div>

      {nudge.detectedContext && (
        <p className={styles.context}>
          <span className={styles.contextQuote} aria-hidden="true">
            “
          </span>
          {nudge.detectedContext}
        </p>
      )}

      <p className={styles.question}>{nudge.suggestedQuestion}</p>

      <div className={styles.privacyBadge}>
        <span className={styles.privacyLocal}>
          <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
            <path d="M6.8 1 2.4 7h2.4L5 11l4.6-6.4H7.2L6.8 1Z" fill="currentColor" />
          </svg>
          Local Nano · {nudge.latencyMs}ms
        </span>
        <span className={styles.privacyDivider} aria-hidden="true" />
        <span className={styles.privacyNote}>
          {nudge.source === 'LOCAL_NANO' ? 'Raw audio stayed in RAM' : 'Cloud fallback used'}
        </span>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.action} onClick={copy}>
          {copied ? (
            <>
              <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                <path d="M2.2 6.4 4.6 8.8 9.8 3.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                <rect x="4" y="4" width="6.2" height="6.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <path d="M8 4V2.6A1.4 1.4 0 0 0 6.6 1.2H2.6A1.4 1.4 0 0 0 1.2 2.6v4A1.4 1.4 0 0 0 2.6 8H4" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              Copy
            </>
          )}
        </button>
        <button
          type="button"
          className={`${styles.action} ${styles.actionPrimary}`}
          onClick={() => onMarkAsked(nudge.id)}
          disabled={nudge.asked}
        >
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
            <path d="M2.2 6.4 4.6 8.8 9.8 3.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {nudge.asked ? 'Asked' : 'Mark asked'}
        </button>
        <button type="button" className={styles.dismiss} onClick={() => onDismiss(nudge.id)} aria-label="Dismiss nudge" title="Dismiss">
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </article>
  );
}

export default function CoPilotFeed({ nudges, activity, onDismiss, onMarkAsked, active, localActive }: CoPilotFeedProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const visible = nudges.filter((nudge) => !nudge.dismissed);

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [activity]);

  return (
    <aside className={styles.feed} aria-label="AI co-pilot feed">
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <h2 className={styles.title}>Co-pilot</h2>
          <span className={`${styles.engineTag} ${localActive ? styles.engineLocal : styles.engineCloud}`}>
            <span className={styles.engineDot} aria-hidden="true" />
            {localActive ? 'on-device' : 'cloud'}
          </span>
        </div>
        <p className={styles.subtitle}>Follow-ups surfaced before you need them</p>
      </header>

      <div className={styles.list}>
        {visible.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.radar} aria-hidden="true">
              <span className={styles.radarSweep} />
              <span className={styles.radarRing} />
              <span className={styles.radarRing2} />
              <span className={styles.radarCore} />
            </div>
            <h3 className={styles.emptyTitle}>{active ? 'Listening for vague answers' : 'No signals yet'}</h3>
            <p className={styles.emptyBody}>
              {active
                ? 'Gemini Nano reads each turn on-device. When an answer gets hedged, the follow-up lands here in under half a second.'
                : 'Start a call and the co-pilot will surface the question you should have asked — with the evidence attached.'}
            </p>
            <span className={styles.emptyHint}>
              <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
                <path d="M6.8 1 2.4 7h2.4L5 11l4.6-6.4H7.2L6.8 1Z" fill="currentColor" />
              </svg>
              sub-500ms · no audio uploaded
            </span>
          </div>
        ) : (
          visible.map((nudge) => (
            <NudgeCard key={nudge.id} nudge={nudge} onDismiss={onDismiss} onMarkAsked={onMarkAsked} />
          ))
        )}
      </div>

      <section className={styles.logSection} aria-label="Hybrid routing activity log">
        <div className={styles.logHeader}>
          <span className={styles.logTitle}>Hybrid routing log</span>
          <span className={styles.logCount}>{activity.length} calls</span>
        </div>
        <div className={styles.log} ref={logRef}>
          {activity.length === 0 ? (
            <p className={styles.logEmpty}>Every inference call is appended here — engine, operation, latency.</p>
          ) : (
            activity.map((entry) => (
              <div key={entry.id} className={styles.logRow}>
                <span className={styles.logTime}>
                  [{new Date(entry.at).toLocaleTimeString('en-US', { hour12: false })}]
                </span>
                <SourceDot source={entry.source} />
                <span className={styles.logSource}>{entry.source}</span>
                <span className={styles.logArrow} aria-hidden="true">
                  →
                </span>
                <span className={styles.logDetail}>{entry.detail}</span>
                <span className={styles.logLatency}>{entry.latencyMs}ms</span>
              </div>
            ))
          )}
        </div>
      </section>
    </aside>
  );
}
