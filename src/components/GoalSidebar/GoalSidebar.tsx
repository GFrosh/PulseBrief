import { useEffect, useRef, useState } from 'react';
import type { SessionGoal } from '../../types/session';
import { SCENARIOS } from '../../data/demoScenario';
import styles from './GoalSidebar.module.css';

interface GoalSidebarProps {
  goals: SessionGoal[];
  scenarioId: string;
  onScenarioChange: (scenarioId: string) => void;
  onUpdateGoal: (goalId: string, text: string) => void;
  onAddGoal: () => void;
  onDeleteGoal: (goalId: string) => void;
  onReset: () => void;
  onToggleGoal?: (goalId: string) => void;
}

const STATUS_COPY: Record<SessionGoal['status'], string> = {
  pending: 'Pending',
  partial: 'Partial',
  covered: 'Covered',
};

function StatusGlyph({ status }: { status: SessionGoal['status'] }) {
  if (status === 'covered') {
    return (
      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
        <path d="M2.2 6.4 4.6 8.8 9.8 3.3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === 'partial') {
    return (
      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
        <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6 1.8a4.2 4.2 0 0 1 0 8.4Z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
      <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />
    </svg>
  );
}

export default function GoalSidebar({
  goals,
  scenarioId,
  onScenarioChange,
  onUpdateGoal,
  onAddGoal,
  onDeleteGoal,
  onReset,
  onToggleGoal,
}: GoalSidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) inputRef.current?.focus();
  }, [editingId]);

  const covered = goals.filter((goal) => goal.status === 'covered').length;
  const partial = goals.filter((goal) => goal.status === 'partial').length;
  const progress = goals.length ? Math.round(((covered + partial * 0.5) / goals.length) * 100) : 0;

  const startEdit = (goal: SessionGoal) => {
    setEditingId(goal.id);
    setDraft(goal.text);
  };

  const commit = () => {
    if (!editingId) return;
    const trimmed = draft.trim();
    if (trimmed) onUpdateGoal(editingId, trimmed);
    setEditingId(null);
  };

  return (
    <aside className={styles.sidebar} aria-label="Session goals">
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <h2 className={styles.title}>Session goals</h2>
          <span className={styles.count}>
            {covered}/{goals.length}
          </span>
        </div>
        <p className={styles.subtitle}>Tracked on-device after every turn</p>
      </div>

      <div className={styles.scenarioBlock}>
        <label className={styles.scenarioLabel} htmlFor="scenario-select">
          Scenario
        </label>
        <div className={styles.selectWrap}>
          <select
            id="scenario-select"
            className={styles.select}
            value={scenarioId}
            onChange={(event) => onScenarioChange(event.target.value)}
          >
            <option value="OPEN_FREEFORM">Open / Freeform Call (No Preset)</option>
            {SCENARIOS.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.label}
              </option>
            ))}
          </select>
          <svg className={styles.selectChevron} viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
            <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <div className={styles.progressRow}>
          <div className={styles.progressTrack} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          </div>
          <span className={styles.progressValue}>{progress}%</span>
        </div>
      </div>

      <div className={styles.list} role="list">
        {goals.length === 0 ? (
          <p className={styles.emptyState}>
            No rigid agenda — PulseBrief is listening dynamically for follow-up opportunities, or add a custom goal below.
          </p>
        ) : goals.map((goal, index) => {
          const isEditing = editingId === goal.id;
          return (
            <article
              key={goal.id}
              role="listitem"
              className={`${styles.card} ${styles[goal.status]}`}
            >
              <div className={styles.cardTop}>
                <span className={styles.index}>{String(index + 1).padStart(2, '0')}</span>
                <span className={`${styles.status} ${styles[`status_${goal.status}`]}`}>
                  <StatusGlyph status={goal.status} />
                  {STATUS_COPY[goal.status]}
                </span>
                {!isEditing && (
                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      className={styles.iconAction}
                      aria-label={`Edit goal ${index + 1}`}
                      title="Edit goal"
                      onClick={() => startEdit(goal)}
                    >
                      <svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">
                        <path d="M9.3 1.9 12 4.6 4.9 11.7 1.8 12l.3-3.1 7.2-7Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={styles.iconAction}
                      aria-label={`Delete goal ${index + 1}`}
                      title="Delete goal"
                      onClick={() => onDeleteGoal(goal.id)}
                    >
                      <svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">
                        <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>

              {isEditing ? (
                <div className={styles.editRow}>
                  <input
                    ref={inputRef}
                    className={styles.editInput}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commit();
                      if (event.key === 'Escape') setEditingId(null);
                    }}
                    aria-label="Goal text"
                  />
                  <button type="button" className={styles.saveButton} onClick={commit}>
                    Save
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={styles.goalText}
                  onClick={() => (goal.text.startsWith('New goal') ? startEdit(goal) : onToggleGoal ? onToggleGoal(goal.id) : startEdit(goal))}
                  title={goal.text.startsWith('New goal') ? 'Edit goal' : onToggleGoal ? 'Toggle covered manually' : 'Edit goal'}
                >
                  {goal.text}
                </button>
              )}

              {goal.evidenceSnippet && (
                <blockquote className={styles.evidence}>
                  <span className={styles.evidenceMark} aria-hidden="true" />
                  “{goal.evidenceSnippet}”
                </blockquote>
              )}

              {goal.updatedBy && (
                <div className={styles.cardMeta}>
                  <span className={styles.metaTag}>
                    <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
                      <path d="M6.8 1 2.4 7h2.4L5 11l4.6-6.4H7.2L6.8 1Z" fill="currentColor" />
                    </svg>
                    Nano · {goal.latencyMs ?? 0}ms
                  </span>
                  <span className={styles.metaDim}>evidence quoted</span>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.addButton} onClick={onAddGoal} disabled={goals.length >= 5} title={goals.length >= 5 ? 'A maximum of five goals can be tracked' : 'Add a custom goal'}>
          <svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">
            <path d="M7 2.5v9M2.5 7h9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Add goal
        </button>
        <button type="button" className={styles.resetButton} onClick={onReset} title="Restore the scenario's default goals">
          Reset
        </button>
      </div>

      <div className={styles.privacyCard}>
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <rect x="3.2" y="7" width="9.6" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M5.6 7V5.4a2.4 2.4 0 0 1 4.8 0V7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <p>
          <strong>PulseBrief never stores audio.</strong> Only text goes to AI models — and PII is
          masked before cloud steps.
        </p>
      </div>
    </aside>
  );
}
