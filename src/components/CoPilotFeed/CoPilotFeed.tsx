import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ActivityEntry, CoPilotNudge, NudgeTrigger, SessionGoal } from '../../types/session';
import styles from './CoPilotFeed.module.css';

interface CoPilotFeedProps {
  nudges: CoPilotNudge[];
  activity: ActivityEntry[];
  onDismiss: (nudgeId: string) => void;
  onMarkAsked: (nudgeId: string) => void;
  active: boolean;
  localActive: boolean;
  goals: SessionGoal[];
  onDock: () => void;
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
          {nudge.source === 'DEMO_ENGINE' ? 'Backup engine' : nudge.source === 'LOCAL_NANO' ? 'Local Nano' : 'Cloud Gemini'} · {nudge.latencyMs}ms
        </span>
        <span className={styles.privacyDivider} aria-hidden="true" />
        <span className={styles.privacyNote}>
          {nudge.source === 'LOCAL_NANO'
            ? 'Answered on this device'
            : nudge.source === 'DEMO_ENGINE'
              ? 'Built in backup, not Gemini'
              : 'Answered in the cloud'}
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

export default function CoPilotFeed({ nudges, activity, onDismiss, onMarkAsked, active, localActive, goals, onDock }: CoPilotFeedProps) {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const pipApi = (window as Window & { documentPictureInPicture?: { requestWindow(options: { width: number; height: number }): Promise<Window> } }).documentPictureInPicture;
  const popOut = async () => {
    if (!pipApi) return;
    const next = await pipApi.requestWindow({ width: 390, height: 540 });
    document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => next.document.head.appendChild(node.cloneNode(true)));
    next.document.documentElement.dataset.theme = document.documentElement.dataset.theme;
    const observer = new MutationObserver(() => { next.document.documentElement.dataset.theme = document.documentElement.dataset.theme; });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    next.addEventListener('pagehide', () => { observer.disconnect(); setPipWindow(null); onDock(); }, { once: true });
    setPipWindow(next);
  };
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
          <div className={styles.headerTitleGroup}>
            <h2 className={styles.title}>Co-pilot</h2>
            <span className={`${styles.engineTag} ${localActive ? styles.engineLocal : styles.engineCloud}`}>
              <span className={styles.engineDot} aria-hidden="true" />
              {localActive ? 'on-device' : 'cloud'}
            </span>
          </div>
          {pipApi && (
            <button type="button" className={styles.popOutBtn} onClick={() => void popOut()} title="Pop out co-pilot nudges into a floating mini window">
              <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                <path d="M5 2H2.5A1.5 1.5 0 0 0 1 3.5v6A1.5 1.5 0 0 0 2.5 11h6A1.5 1.5 0 0 0 10 9.5V7M7.5 1H11v3.5M11 1 5.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Pop out</span>
            </button>
          )}
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
                ? 'Reads incoming transcript turns and surfaces follow-up prompts when an answer is vague or incomplete.'
                : 'Start a call and the co-pilot will surface the question you should have asked — with the evidence attached.'}
            </p>
            <span className={styles.emptyHint}>
              <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
                <path d="M6.8 1 2.4 7h2.4L5 11l4.6-6.4H7.2L6.8 1Z" fill="currentColor" />
              </svg>
              Fast follow-ups · no audio stored
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
      {pipWindow &&
        createPortal(
          <main className={styles.pipRoot}>
            <header className={styles.pipHeader}>
              <div className={styles.pipTitleRow}>
                <strong>PulseBrief Co-pilot</strong>
                <span className={`${styles.engineTag} ${localActive ? styles.engineLocal : styles.engineCloud}`}>
                  <span className={styles.engineDot} aria-hidden="true" />
                  {localActive ? 'Nano Active' : navigator.onLine ? 'Cloud' : 'Offline'}
                </span>
              </div>
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  pipWindow.close();
                  setPipWindow(null);
                  onDock();
                }}
              >
                Dock Back
              </button>
            </header>

            <section className={styles.pipGoals}>
              <div className={styles.pipGoalsHead}>
                <strong>
                  {goals.filter((g) => g.status === 'covered').length}/{goals.length} Goals Covered
                </strong>
              </div>
              <div className={styles.pipProgressBar}>
                {goals.map((g) => (
                  <i
                    key={g.id}
                    className={
                      g.status === 'covered'
                        ? styles.pipSegCovered
                        : g.status === 'partial'
                          ? styles.pipSegPartial
                          : styles.pipSegPending
                    }
                  />
                ))}
              </div>
              <div className={styles.pipGoalChips}>
                {goals.map((g) => (
                  <span
                    key={g.id}
                    className={`${styles.pipGoalChip} ${g.status === 'covered' ? styles.pipGoalChipCovered : ''}`}
                  >
                    {g.status === 'covered' ? '✓' : g.status === 'partial' ? '◐' : '○'} {g.text}
                  </span>
                ))}
              </div>
            </section>

            <section className={styles.pipNudges}>
              <h3 className={styles.pipSubheading}>Follow-up nudges</h3>
              {visible.length === 0 ? (
                <p className={styles.pipEmpty}>Listening for follow-up opportunities…</p>
              ) : (
                visible.map((n) => (
                  <article key={n.id} className={`${styles.card} ${n.asked ? styles.cardAsked : ''}`}>
                    <p className={styles.question}>{n.suggestedQuestion}</p>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.action}
                        onClick={() =>
                          void pipWindow.navigator.clipboard
                            ?.writeText(n.suggestedQuestion)
                            .catch(() => navigator.clipboard.writeText(n.suggestedQuestion))
                        }
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        className={`${styles.action} ${styles.actionPrimary}`}
                        onClick={() => onMarkAsked(n.id)}
                        disabled={n.asked}
                      >
                        {n.asked ? 'Asked' : 'Mark Asked'}
                      </button>
                      <button
                        type="button"
                        className={styles.dismiss}
                        onClick={() => onDismiss(n.id)}
                        aria-label="Dismiss nudge"
                      >
                        ✕
                      </button>
                    </div>
                  </article>
                ))
              )}
            </section>
          </main>,
          pipWindow.document.body,
        )}
    </aside>
  );
}
