import { useEffect, useRef, useState } from 'react';
import type { Speaker, TranscriptSegment } from '../../types/session';
import { scenarioDurationSeconds } from '../../services/speechService';
import styles from './LiveTranscript.module.css';

interface LiveTranscriptProps {
  segments: TranscriptSegment[];
  interim: { speaker: Speaker; text: string } | null;
  onStartMic: () => void;
  onStopMic: () => void;
  onSimulate: () => void;
  onStopSimulation: () => void;
  onEndCall: () => void;
  onSpeedChange: (speed: number) => void;
  speed: number;
  listening: boolean;
  simulating: boolean;
  micSupported: boolean;
  canSynthesize: boolean;
  synthesizing: boolean;
  elapsedLabel: string;
  sessionTitle: string;
  sessionMeta: string;
  scriptedSeconds: number;
  error: string | null;
  onDismissError: () => void;
}

const SPEEDS = [1, 2.5];

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '--:--:--';
  }
}

export default function LiveTranscript({
  segments,
  interim,
  onStartMic,
  onStopMic,
  onSimulate,
  onStopSimulation,
  onEndCall,
  onSpeedChange,
  speed,
  listening,
  simulating,
  micSupported,
  canSynthesize,
  synthesizing,
  elapsedLabel,
  sessionTitle,
  sessionMeta,
  scriptedSeconds,
  error,
  onDismissError,
}: LiveTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    if (!pinned) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [segments, interim, pinned]);

  const handleScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    setPinned(distance < 96);
  };

  const wordCount = segments.reduce((total, segment) => total + segment.text.split(/\s+/).length, 0);
  const active = listening || simulating;

  return (
    <section className={styles.transcript} aria-label="Live transcript">
      <header className={styles.header}>
        <div className={styles.headingGroup}>
          <div className={styles.titleRow}>
            <h2 className={styles.title}>Live transcript</h2>
            {active && (
              <span className={styles.liveChip}>
                <span className={styles.liveDot} aria-hidden="true" />
                {simulating ? 'SIMULATED' : 'REC'}
              </span>
            )}
          </div>
          <p className={styles.sessionMeta}>
            {sessionTitle}
            <span className={styles.dotSeparator} aria-hidden="true" />
            {sessionMeta}
          </p>
        </div>

        <div className={styles.stats}>
          <span className={styles.stat}>
            <span className={styles.statValue}>{segments.length}</span>
            <span className={styles.statLabel}>turns</span>
          </span>
          <span className={styles.stat}>
            <span className={styles.statValue}>{wordCount}</span>
            <span className={styles.statLabel}>words</span>
          </span>
          <span className={`${styles.stat} ${styles.timer}`}>
            <span className={styles.statValue}>{elapsedLabel}</span>
          </span>
        </div>
      </header>

      <div className={styles.controls}>
        <div className={styles.controlGroup}>
          {listening ? (
            <button type="button" className={`${styles.micButton} ${styles.micActive}`} onClick={onStopMic}>
              <span className={styles.wave} aria-hidden="true">
                <i /> <i /> <i /> <i /> <i />
              </span>
              Stop listening
            </button>
          ) : (
            <button
              type="button"
              className={styles.micButton}
              onClick={onStartMic}
              disabled={simulating || !micSupported}
              title={micSupported ? 'Capture your microphone in this browser' : 'Web Speech API is not available in this browser'}
            >
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <rect x="5.6" y="1.6" width="4.8" height="8" rx="2.4" fill="currentColor" />
                <path d="M3.4 7.6a4.6 4.6 0 0 0 9.2 0M8 12.2v2.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              Start live mic
            </button>
          )}

          {simulating ? (
            <button type="button" className={`${styles.simButton} ${styles.simActive}`} onClick={onStopSimulation}>
              <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                <rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1.6" fill="currentColor" />
              </svg>
              Stop simulation
            </button>
          ) : (
            <button
              type="button"
              className={styles.simButton}
              onClick={onSimulate}
              disabled={listening}
              title={`Stream a ${scriptedSeconds}s discovery call (${speed}x)`}
            >
              <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                <path d="M3.4 1.9 10 6l-6.6 4.1V1.9Z" fill="currentColor" />
              </svg>
              Simulate live call
            </button>
          )}

          <div className={styles.speedToggle} role="group" aria-label="Simulation speed">
            {SPEEDS.map((option) => (
              <button
                key={option}
                type="button"
                className={`${styles.speedOption} ${speed === option ? styles.speedActive : ''}`}
                onClick={() => onSpeedChange(option)}
                aria-pressed={speed === option}
                title={option === 1 ? 'Natural conversational pace' : 'Fast demo pace'}
              >
                {option === 1 ? '1x' : '2.5x'}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className={styles.endButton}
          onClick={onEndCall}
          disabled={!canSynthesize || synthesizing}
          title="Redact PII on-device, then synthesize the brief in the cloud"
        >
          {synthesizing ? (
            <>
              <span className={styles.spinner} aria-hidden="true" />
              Synthesizing…
            </>
          ) : (
            <>
              <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
                <path d="M7 1.4 8.5 5l3.7.3-2.8 2.5.8 3.6L7 9.5l-3.2 1.9.8-3.6L1.8 5.3 5.5 5 7 1.4Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              End call &amp; synthesize
            </>
          )}
        </button>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 4.8v4M8 10.8v.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span>{error}</span>
          <button type="button" onClick={onDismissError} aria-label="Dismiss error">
            <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
              <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      <div className={styles.feed} ref={scrollRef} onScroll={handleScroll}>
        {segments.length === 0 && !interim ? (
          <div className={styles.empty}>
            <div className={styles.emptyGlyph} aria-hidden="true">
              <span className={styles.emptyRing} />
              <svg viewBox="0 0 24 24" width="26" height="26">
                <path d="M2.5 13h4l2-5.5 3.2 10.5 2.6-8 1.7 4h5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3 className={styles.emptyTitle}>Your co-pilot is listening for signal</h3>
            <p className={styles.emptyBody}>
              Start a real microphone session, or run the scripted discovery call to watch Gemini Nano
              track goals, surface follow-ups and mask PII — hands-free.
            </p>
            <div className={styles.emptyActions}>
              <button type="button" className={styles.emptyPrimary} onClick={onSimulate}>
                <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                  <path d="M3.4 1.9 10 6l-6.6 4.1V1.9Z" fill="currentColor" />
                </svg>
                Simulate live call
              </button>
              <button type="button" className={styles.emptySecondary} onClick={onStartMic} disabled={!micSupported}>
                Use my microphone
              </button>
            </div>
            <div className={styles.emptyFeatureRow}>
              <span>
                <i className={styles.featureDot} style={{ background: 'var(--color-local)' }} />
                On-device goal tracking
              </span>
              <span>
                <i className={styles.featureDot} style={{ background: 'var(--color-cloud)' }} />
                Cloud synthesis
              </span>
              <span>
                <i className={styles.featureDot} style={{ background: 'var(--color-redacted)' }} />
                PII masked locally
              </span>
            </div>
          </div>
        ) : (
          <>
            {segments.map((segment) => {
              const isYou = segment.speaker === 'You (Interviewer)';
              const highlighted = (segment.matchedGoalIds?.length ?? 0) > 0;
              return (
                <article
                  key={segment.id}
                  className={`${styles.segment} ${isYou ? styles.you : styles.guest} ${highlighted ? styles.highlighted : ''}`}
                >
                  <div className={styles.segmentHead}>
                    <span className={styles.speakerChip}>
                      <span className={`${styles.avatar} ${isYou ? styles.avatarYou : styles.avatarGuest}`} aria-hidden="true">
                        {isYou ? 'Y' : 'G'}
                      </span>
                      {segment.speaker}
                    </span>
                    <span className={styles.time}>{formatTime(segment.timestamp)}</span>
                    {highlighted && (
                      <span className={styles.matchChip} title="Cited as evidence for a session goal">
                        <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
                          <path d="M2.2 6.4 4.6 8.8 9.8 3.3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        goal evidence
                      </span>
                    )}
                    {segment.containsPii && (
                      <span className={styles.piiChip} title="PII detected — masked on-device before cloud escalation">
                        PII
                      </span>
                    )}
                  </div>
                  <p className={styles.segmentText}>{segment.text}</p>
                </article>
              );
            })}

            {interim && (
              <article className={`${styles.segment} ${styles.interim} ${interim.speaker === 'You (Interviewer)' ? styles.you : styles.guest}`}>
                <div className={styles.segmentHead}>
                  <span className={styles.speakerChip}>
                    <span className={`${styles.avatar} ${interim.speaker === 'You (Interviewer)' ? styles.avatarYou : styles.avatarGuest}`} aria-hidden="true">
                      {interim.speaker === 'You (Interviewer)' ? 'Y' : 'G'}
                    </span>
                    {interim.speaker}
                  </span>
                  <span className={styles.time}>live</span>
                </div>
                <p className={styles.segmentText}>
                  {interim.text}
                  <span className={styles.caret} aria-hidden="true" />
                </p>
              </article>
            )}

            {!pinned && (
              <button
                type="button"
                className={styles.jumpButton}
                onClick={() => {
                  const node = scrollRef.current;
                  if (node) node.scrollTop = node.scrollHeight;
                  setPinned(true);
                }}
              >
                Jump to live
                <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
                  <path d="M6 2.5v7M3 6.5 6 9.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>

      <footer className={styles.footer}>
        <span className={styles.footerItem}>
          <span className={`${styles.footerDot} ${active ? styles.footerDotLive : ''}`} aria-hidden="true" />
          {active ? (simulating ? 'Scripted stream running' : 'Microphone capturing') : 'Idle — waiting for audio'}
        </span>
        <span className={styles.footerDivider} aria-hidden="true" />
        <span className={styles.footerItem}>
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
            <rect x="2.6" y="5.2" width="6.8" height="5" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
            <path d="M4.2 5.2V3.9a1.8 1.8 0 0 1 3.6 0v1.3" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          </svg>
          Audio processed in RAM only
        </span>
        <span className={styles.footerSpacer} />
        <span className={styles.footerItem}>
          {scriptedSeconds}s script · {speed}x
        </span>
      </footer>
    </section>
  );
}
