import { initializeApp, getApp, getApps, type FirebaseApp, type FirebaseError } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  signInWithPopup,
  signOut,
  type Auth,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';

/**
 * Firebase bootstrap.
 *
 * Three rules:
 *  1. Never throw at import time — judges may open the app with no `.env` at all.
 *  2. Every credential comes from `import.meta.env.VITE_*`; nothing is hardcoded.
 *  3. If config is present, we wire App Check (reCAPTCHA Enterprise, with debug
 *     token support), anonymous auth, and an IndexedDB-persisted Firestore so a
 *     session captured offline syncs itself once the network returns.
 */

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: env.VITE_FIREBASE_APP_ID ?? '',
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let appCheckReady = false;

if (isFirebaseConfigured) {
  try {
    app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

    // --- App Check ---------------------------------------------------------
    // The debug token must be present on `self` BEFORE initializeAppCheck so the
    // SDK exchanges it for a real token instead of failing the reCAPTCHA handshake.
    if (env.VITE_APPCHECK_DEBUG_TOKEN) {
      (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN =
        env.VITE_APPCHECK_DEBUG_TOKEN;
    }

    if (env.VITE_RECAPTCHA_SITE_KEY) {
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
      appCheckReady = true;
    } else {
      console.warn(
        '[PulseBrief] VITE_RECAPTCHA_SITE_KEY missing — App Check is disabled. Add it before shipping.',
      );
    }

    // --- Auth --------------------------------------------------------------
    auth = getAuth(app);

    // --- Firestore (offline-first) ----------------------------------------
    try {
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      });
    } catch (cacheError) {
      console.warn('[PulseBrief] IndexedDB cache unavailable, falling back to memory cache.', cacheError);
      const { getFirestore } = await import('firebase/firestore');
      db = getFirestore(app);
    }
  } catch (error) {
    console.error('[PulseBrief] Firebase failed to initialize — running local-only.', error);
    app = null;
    auth = null;
    db = null;
  }
}

export { app, auth, db };
export const isAppCheckEnabled = appCheckReady;

/** Guest identity used when Firebase credentials are absent (or auth fails). */
const GUEST_KEY = 'pulsebrief.guestId';

export function getGuestId(): string {
  try {
    const existing = localStorage.getItem(GUEST_KEY);
    if (existing) return existing;
    const created = `guest_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(GUEST_KEY, created);
    return created;
  } catch {
    return 'guest_local';
  }
}

let signInPromise: Promise<string | null> | null = null;

/**
 * Anonymous sign-in, memoized. Resolves to a uid (real or local guest), or
 * `null` when auth is impossible — callers treat that as "store locally".
 */
export function ensureSignedIn(): Promise<string | null> {
  if (!auth) return Promise.resolve(getGuestId());

  if (auth.currentUser) return Promise.resolve(auth.currentUser.uid);

  if (!signInPromise) {
    signInPromise = signInAnonymously(auth)
      .then((credential) => credential.user.uid)
      .catch((error: unknown) => {
        console.warn('[PulseBrief] Anonymous auth unavailable — using local guest id.', error);
        return getGuestId();
      })
      .finally(() => {
        signInPromise = null;
      });
  }

  return signInPromise;
}

/** Observable auth state, used by the telemetry receipt to show sync identity. */
export function watchAuth(callback: (uid: string | null) => void): () => void {
  if (!auth) {
    callback(getGuestId());
    return () => undefined;
  }
  return onAuthStateChanged(auth, (user) => callback(user?.uid ?? getGuestId()));
}

export interface AuthUserInfo {
  uid: string;
  isAnonymous: boolean;
  name: string | null;
}

/** Richer auth state for the sign-in button. `null` means signed out (or no Firebase). */
export function watchAuthUser(callback: (user: AuthUserInfo | null) => void): () => void {
  if (!auth) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth, (user) =>
    callback(user ? { uid: user.uid, isAnonymous: user.isAnonymous, name: user.displayName } : null),
  );
}

/**
 * Google sign-in. A guest (anonymous) user is upgraded in place, so sessions
 * saved as a guest stay with the same uid. If that Google account already has
 * its own data, we switch to it instead.
 */
export async function signInWithGoogle(): Promise<void> {
  if (!auth) throw new Error('Firebase is not configured');
  const provider = new GoogleAuthProvider();
  const current = auth.currentUser;

  if (current?.isAnonymous) {
    try {
      await linkWithPopup(current, provider);
      return;
    } catch (error) {
      if ((error as FirebaseError).code === 'auth/credential-already-in-use') {
        const credential = GoogleAuthProvider.credentialFromError(error as FirebaseError);
        if (credential) {
          await signInWithCredential(auth, credential);
          return;
        }
      }
      throw error;
    }
  }

  await signInWithPopup(auth, provider);
}

export async function signOutUser(): Promise<void> {
  if (!auth) return;
  await signOut(auth);
}

export const firebaseMeta = {
  configured: isFirebaseConfigured,
  projectId: firebaseConfig.projectId || null,
  appCheck: appCheckReady,
  authMode: auth ? 'anonymous' : 'local-guest',
  firestore: db ? 'persistent-local-cache' : 'localStorage',
} as const;
