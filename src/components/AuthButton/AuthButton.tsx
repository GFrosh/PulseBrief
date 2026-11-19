import { useEffect, useState } from 'react';
import {
  isFirebaseConfigured,
  signInWithGoogle,
  signOutUser,
  watchAuthUser,
  type AuthUserInfo,
} from '../../config/firebase';
import styles from './AuthButton.module.css';

/** Guests can use the app straight away; Google sign-in is optional and keeps their briefs. */
export default function AuthButton() {
  const [user, setUser] = useState<AuthUserInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => watchAuthUser(setUser), []);

  if (!isFirebaseConfigured) return null;

  const signedIn = Boolean(user && !user.isAnonymous);

  const handleClick = async () => {
    setBusy(true);
    setError(null);
    try {
      if (signedIn) await signOutUser();
      else await signInWithGoogle();
    } catch (err) {
      const code = (err as { code?: string }).code;
      // Closing the popup is not an error worth showing.
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        setError('Sign in did not finish. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const label = signedIn ? `${user?.name?.split(' ')[0] ?? 'Signed in'} · Sign out` : 'Sign in with Google';

  return (
    <button
      type="button"
      className={styles.button}
      onClick={handleClick}
      disabled={busy}
      title={error ?? (signedIn ? 'Sign out of your Google account' : 'Optional: keep your briefs across visits')}
    >
      {error ? 'Try again' : label}
    </button>
  );
}
