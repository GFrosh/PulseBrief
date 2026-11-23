import { useEffect, useMemo, useState } from 'react';
import type { PostCallBrief, SyncStatus } from '../../types/session';
import TelemetryReceipt from '../TelemetryReceipt/TelemetryReceipt';
import styles from './PostCallBriefModal.module.css';

interface PostCallBriefModalProps {
  open: boolean;
  phase: 'redacting' | 'cloud' | 'ready';
  brief: PostCallBrief | null;
  redactionCount: number;
  syncStatus: SyncStatus;
  onClose: () => void;
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      document.body.removeChild(area);
    }
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1800);
  };

  return { copied, copy };
}

export default function PostCallBriefModal({
  open,
  phase,
  brief,
  redactionCount,
  syncStatus,
  onClose,
}: PostCallBriefModalProps) {
  const [showRaw, setShowRaw] = useState(false);
  const { copied, copy } = useCopy();

  useEffect(() => {
    if (!open) {
      setShowRaw(false);
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const crmJson = useMemo(() => (brief ? JSON.stringify(brief.crmFields, null, 2) : ''), [brief]);

  if (!open) return null;

  const step1Done = phase !== 'redacting';
  const step2Done = phase === 'ready';

  const rawTranscriptAvailable = Boolean(brief?.rawTranscript.trim());
  const showRawTranscript = showRaw && rawTranscriptAvailable;
  const transcript = brief
    ? showRawTranscript
      ? brief.rawTranscript
      : brief.sanitizedTranscript
    : '';

  const downloadJson = () => {
    if (!brief) return;
    const blob = new Blob([JSON.stringify(brief, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'pulsebrief-session.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Post-call brief">
      <div className={styles.panel}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.badge}>
              <svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">
                <path d="M7 1.4 8.5 5l3.7.3-2.8 2.5.8 3.6L7 9.5l-3.2 1.9.8-3.6L1.8 5.3 5.5 5 7 1.4Z" fill="currentColor" />
              </svg>
              Post-call brief
            </span>
            {brief && <h2 className={styles.title}>{brief.title}</h2>}
            {!brief && <h2 className={styles.title}>Synthesizing your brief…</h2>}
            {brief && (
              <p className={styles.metaLine}>
                {brief.contact} · generated {new Date(brief.createdAt).toLocaleTimeString('en-US', { hour12: false })}
                <span className={styles.metaDot} aria-hidden="true" />
                {brief.goalOutcomes.filter((goal) => goal.status === 'covered').length}/{brief.goalOutcomes.length} goals covered
              </p>
            )}
            {!brief && (
              <p className={styles.metaLine}>
                Two steps: local privacy gate, then cloud synthesis on sanitized text only.
              </p>
            )}
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close brief">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className={styles.steps} aria-live="polite">
          <div className={`${styles.step} ${step1Done ? styles.stepDone : styles.stepActive}`}>
            <span className={styles.stepIcon}>
              {step1Done ? (
                <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                  <path d="M2.2 6.4 4.6 8.8 9.8 3.3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span className={styles.stepSpinner} aria-hidden="true" />
              )}
            </span>
            <div>
              <span className={styles.stepLabel}>Step 1 · On-device</span>
              <span className={styles.stepText}>
                {phase === 'redacting'
                  ? 'Redacting PII locally before cloud escalation…'
                  : `PII masked before upload${redactionCount ? ` — ${redactionCount} sensitive items` : ' — no PII found'}`}
              </span>
            </div>
          </div>

          <span className={`${styles.stepConnector} ${step1Done ? styles.connectorDone : ''}`} aria-hidden="true" />

          <div className={`${styles.step} ${step2Done ? styles.stepDone : phase === 'cloud' ? styles.stepActive : styles.stepIdle}`}>
            <span className={styles.stepIcon}>
              {step2Done ? (
                <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                  <path d="M2.2 6.4 4.6 8.8 9.8 3.3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : phase === 'cloud' ? (
                <span className={styles.stepSpinner} aria-hidden="true" />
              ) : (
                <span className={styles.stepDot} aria-hidden="true" />
              )}
            </span>
            <div>
              <span className={styles.stepLabel}>Step 2 · Cloud</span>
              <span className={styles.stepText}>
                {phase === 'cloud'
                  ? 'Escalating sanitized transcript to Cloud Gemini…'
                  : step2Done
                    ? 'Brief synthesized from sanitized text only'
                    : 'Waiting for the privacy gate'}
              </span>
            </div>
          </div>

          {step2Done && brief && (
            <div className={styles.stepProof}>
              <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                <rect x="2.4" y="5.2" width="7.2" height="4.8" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.1" />
                <path d="M4.1 5.2V3.9a1.9 1.9 0 0 1 3.8 0v1.3" fill="none" stroke="currentColor" strokeWidth="1.1" />
              </svg>
              {redactionCount} entities never left the device
            </div>
          )}
        </div>

        <div className={styles.body}>
          {!brief ? (
            <div className={styles.skeletonWrap}>
              <div className={styles.skeletonLine} style={{ width: '72%' }} />
              <div className={styles.skeletonLine} style={{ width: '94%' }} />
              <div className={styles.skeletonLine} style={{ width: '88%' }} />
              <div className={styles.skeletonGrid}>
                {[0, 1, 2, 3, 4].map((index) => (
                  <div key={index} className={styles.skeletonCard} />
                ))}
              </div>
              <p className={styles.skeletonNote}>
                The cloud request is built only after every [REDACTED_*] placeholder is in place.
              </p>
            </div>
          ) : (
            <div className={styles.content}>
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h3 className={styles.sectionTitle}>Executive summary</h3>
                  <span className={styles.sectionMeta}>{brief.executiveSummary.length} bullets · grounded in transcript</span>
                </div>
                <ol className={styles.summaryList}>
                  {brief.executiveSummary.map((line, index) => (
                    <li key={index} className={styles.summaryItem}>
                      <span className={styles.summaryIndex}>{String(index + 1).padStart(2, '0')}</span>
                      <p>{line}</p>
                    </li>
                  ))}
                </ol>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h3 className={styles.sectionTitle}>Goal outcomes</h3>
                  <span className={styles.sectionMeta}>
                    tracked on-device during the call
                  </span>
                </div>
                <div className={styles.goalGrid}>
                  {brief.goalOutcomes.map((goal) => (
                    <article key={goal.id} className={`${styles.goalCard} ${styles[`goal_${goal.status}`]}`}>
                      <span className={`${styles.goalStatus} ${styles[`statusText_${goal.status}`]}`}>
                        {goal.status === 'covered' ? 'Covered' : goal.status === 'partial' ? 'Partial' : 'Not covered'}
                      </span>
                      <p className={styles.goalText}>{goal.text}</p>
                      {goal.evidenceSnippet && <p className={styles.goalEvidence}>“{goal.evidenceSnippet}”</p>}
                    </article>
                  ))}
                </div>
              </section>

              <div className={styles.twoCol}>
                <section className={styles.section}>
                  <div className={styles.sectionHead}>
                    <h3 className={styles.sectionTitle}>CRM action items</h3>
                    <button type="button" className={styles.copyButton} onClick={() => copy('crm', crmJson)}>
                      {copied === 'crm' ? 'Copied JSON' : 'Copy CRM JSON'}
                    </button>
                  </div>
                  <dl className={styles.crm}>
                    {(
                      [
                        ['Pain point', brief.crmFields.painPoint],
                        ['Current stack', brief.crmFields.currentStack],
                        ['Budget authority', brief.crmFields.budgetAuthority],
                        ['Timeline', brief.crmFields.timeline],
                        ['Next step', brief.crmFields.nextStep],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label} className={styles.crmRow}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section className={styles.section}>
                  <div className={styles.sectionHead}>
                    <h3 className={styles.sectionTitle}>Follow-up email</h3>
                    <button type="button" className={styles.copyButton} onClick={() => copy('email', brief.followUpEmailDraft)}>
                      {copied === 'email' ? 'Copied email' : 'Copy email'}
                    </button>
                  </div>
                  <pre className={styles.email}>{brief.followUpEmailDraft}</pre>
                </section>
              </div>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <h3 className={styles.sectionTitle}>Transcript</h3>
                  <div className={styles.diffToggle} role="group" aria-label="Transcript view">
                    <button
                      type="button"
                      className={`${styles.diffOption} ${!showRaw ? styles.diffActive : ''}`}
                      onClick={() => setShowRaw(false)}
                      aria-pressed={!showRaw}
                    >
                      Sanitized
                    </button>
                    <button
                      type="button"
                      className={`${styles.diffOption} ${showRaw ? styles.diffActive : ''}`}
                      onClick={() => setShowRaw(true)}
                      disabled={!rawTranscriptAvailable}
                      aria-pressed={showRaw}
                    >
                      {rawTranscriptAvailable ? 'Raw' : 'Raw unavailable'}
                    </button>
                  </div>
                </div>
                <div className={styles.transcriptBox}>
                  {transcript.split(/(\[REDACTED_[A-Z]+\])/g).map((chunk, index) =>
                    /^\[REDACTED_[A-Z]+\]$/.test(chunk) ? (
                      <mark key={index} className={styles.redaction}>
                        {chunk}
                      </mark>
                    ) : (
                      <span key={index}>{chunk}</span>
                    ),
                  )}
                </div>
                <p className={styles.transcriptNote}>
                  {showRawTranscript
                    ? 'Raw transcript — kept in memory for this review only, never sent to the cloud.'
                    : `Sanitized transcript — ${redactionCount} entities replaced with placeholders. This exact text is what Cloud Gemini received.`}
                </p>
              </section>

              <TelemetryReceipt
                telemetry={brief.telemetry}
                redactionCount={redactionCount}
                syncStatus={syncStatus}
                cloudLatencyMs={brief.cloudLatencyMs}
                engine={brief.engine}
                transcript={brief.sanitizedTranscript}
              />

              <div className={styles.footActions}>
                <button type="button" className={styles.secondary} onClick={downloadJson}>
                  <svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">
                    <path d="M7 2v7M4.2 6.4 7 9.2l2.8-2.8M2.6 11.4h8.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Download JSON
                </button>
                <button type="button" className={styles.primary} onClick={onClose}>
                  Back to workspace
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
