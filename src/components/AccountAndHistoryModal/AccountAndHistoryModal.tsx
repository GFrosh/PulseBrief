import { useEffect, useState, type FormEvent } from 'react';
import {
  isFirebaseConfigured,
  signInWithEmailAccount,
  signInWithGoogleAccount,
  signOutAccount,
  type AuthSession,
} from '../../config/firebase';
import { deleteSession, listSessions, type StoredSession } from '../../services/sessionStore';
import type { PostCallBrief } from '../../types/session';
import styles from './AccountAndHistoryModal.module.css';

interface AccountAndHistoryModalProps {
  open: boolean;
  initialTab: 'account' | 'history';
  session: AuthSession;
  onSessionChange: (session: AuthSession) => void;
  onOpenBrief: (brief: PostCallBrief) => void;
  onClose: () => void;
}

export default function AccountAndHistoryModal({
  open,
  initialTab,
  session,
  onSessionChange,
  onOpenBrief,
  onClose,
}: AccountAndHistoryModalProps) {
  const [tab, setTab] = useState<'account' | 'history'>(initialTab);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setAuthError(null);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadingList(true);
    listSessions(session.uid)
      .then((items) => {
        if (active) setSessions(items);
      })
      .finally(() => {
        if (active) setLoadingList(false);
      });
    return () => {
      active = false;
    };
  }, [open, session.uid, tab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isSignedInUser = !session.isAnonymous;

  const handleGoogleSignIn = async () => {
    setBusy(true);
    setAuthError(null);
    try {
      const next = await signInWithGoogleAccount();
      onSessionChange(next);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setAuthError(null);
    try {
      const next = await signInWithEmailAccount(email, password, isRegister);
      onSessionChange(next);
      setEmail('');
      setPassword('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    setAuthError(null);
    try {
      const next = await signOutAccount();
      onSessionChange(next);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (sessionId: string) => {
    await deleteSession(sessionId);
    setSessions((prev) => prev.filter((item) => item.id !== sessionId));
  };

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Account and saved calls">
      <div className={styles.panel}>
        <header className={styles.header}>
          <div>
            <span className={styles.badge}>Firebase Auth &amp; Firestore</span>
            <h2 className={styles.title}>Account &amp; Saved Calls</h2>
            <p className={styles.subtitle}>
              Sanitized briefs are scoped to your session ID so each user sees only their own calls.
            </p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close modal">
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className={styles.tabs} role="tablist" aria-label="Account and saved calls tabs">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'history'}
            className={`${styles.tab} ${tab === 'history' ? styles.tabActive : ''}`}
            onClick={() => setTab('history')}
          >
            Saved calls ({sessions.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'account'}
            className={`${styles.tab} ${tab === 'account' ? styles.tabActive : ''}`}
            onClick={() => setTab('account')}
          >
            {isSignedInUser ? 'Account' : 'Sign in'}
          </button>
        </div>

        <div className={styles.body}>
          {tab === 'history' ? (
            <div className={styles.historyPane}>
              {loadingList ? (
                <p className={styles.emptyNote}>Loading saved call briefs…</p>
              ) : sessions.length === 0 ? (
                <div className={styles.emptyBox}>
                  <h3 className={styles.emptyTitle}>No saved calls yet</h3>
                  <p className={styles.emptyBody}>
                    Run a live microphone session or simulated call and click <strong>End call &amp; synthesize</strong>.
                    Every completed brief is saved here automatically.
                  </p>
                </div>
              ) : (
                <ul className={styles.sessionList}>
                  {sessions.map((item) => {
                    const covered = item.brief.goalOutcomes.filter((g) => g.status === 'covered').length;
                    return (
                      <li key={item.id} className={styles.sessionCard}>
                        <div className={styles.sessionMain}>
                          <div className={styles.sessionTop}>
                            <strong className={styles.sessionTitle}>{item.brief.title}</strong>
                            <span className={styles.sessionEngine}>{item.brief.engine}</span>
                          </div>
                          <p className={styles.sessionMeta}>
                            {item.brief.contact ?? 'Call session'} ·{' '}
                            {new Date(item.savedAt).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: false,
                            })}{' '}
                            · {covered}/{item.brief.goalOutcomes.length} goals covered · {item.brief.redactionCount} PII masked
                          </p>
                        </div>
                        <div className={styles.sessionActions}>
                          <button
                            type="button"
                            className={styles.openBtn}
                            onClick={() => {
                              onClose();
                              onOpenBrief(item.brief);
                            }}
                          >
                            Open brief
                          </button>
                          <button
                            type="button"
                            className={styles.deleteBtn}
                            onClick={() => void handleDelete(item.id)}
                            aria-label={`Delete ${item.brief.title}`}
                            title="Delete saved brief"
                          >
                            <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
                              <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                            </svg>
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <div className={styles.accountPane}>
              <div className={styles.identityCard}>
                <span className={styles.avatar}>
                  {(session.displayName || session.email || 'G').slice(0, 1).toUpperCase()}
                </span>
                <div className={styles.identityInfo}>
                  <strong>{session.displayName || 'Local Guest'}</strong>
                  <span>{session.email ?? `Session ID: ${session.uid}`}</span>
                </div>
                <span className={`${styles.rolePill} ${isSignedInUser ? styles.roleSignedIn : styles.roleGuest}`}>
                  {isSignedInUser ? 'Signed in' : session.isGuest ? 'Local guest' : 'Anonymous'}
                </span>
              </div>

              {!isFirebaseConfigured && (
                <p className={styles.notice}>
                  Firebase environment keys are not set yet — signing in below creates a local profile for testing
                  and automatically upgrades once Firebase Auth is connected.
                </p>
              )}

              {authError && (
                <div className={styles.errorBox} role="alert">
                  {authError}
                </div>
              )}

              {isSignedInUser ? (
                <div className={styles.signedInActions}>
                  <button type="button" className={styles.secondaryBtn} onClick={() => setTab('history')}>
                    View saved calls ({sessions.length})
                  </button>
                  <button type="button" className={styles.dangerBtn} onClick={() => void handleSignOut()} disabled={busy}>
                    Sign out
                  </button>
                </div>
              ) : (
                <>
                  {isFirebaseConfigured && (
                    <button
                      type="button"
                      className={styles.googleBtn}
                      onClick={() => void handleGoogleSignIn()}
                      disabled={busy}
                    >
                      Continue with Google
                    </button>
                  )}

                  <form className={styles.form} onSubmit={(e) => void handleEmailSubmit(e)}>
                    <label className={styles.label}>
                      <span>Work email</span>
                      <input
                        type="email"
                        className={styles.input}
                        placeholder="you@company.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </label>
                    <label className={styles.label}>
                      <span>Password</span>
                      <input
                        type="password"
                        className={styles.input}
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                    </label>

                    <div className={styles.formFooter}>
                      <button type="submit" className={styles.primaryBtn} disabled={busy}>
                        {busy ? 'Signing in…' : isRegister ? 'Create account' : 'Sign in with email'}
                      </button>
                      <button
                        type="button"
                        className={styles.linkBtn}
                        onClick={() => setIsRegister((prev) => !prev)}
                      >
                        {isRegister ? 'Already have an account? Sign in' : 'Need an account? Register'}
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
