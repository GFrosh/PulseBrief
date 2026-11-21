import { FirebaseError, initializeApp, getApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  linkWithPopup,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithCredential,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
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
 *     token support), Firebase Auth (Google, Email/Password, or Anonymous),
 *     and an IndexedDB-persisted Firestore so a session captured offline syncs
 *     itself once the network returns.
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
    const extensionOrigin = window.location.protocol === 'chrome-extension:';
    if (extensionOrigin) {
      (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = env.VITE_APPCHECK_DEBUG_TOKEN || true;
    } else if (env.VITE_APPCHECK_DEBUG_TOKEN) {
      (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN =
        env.VITE_APPCHECK_DEBUG_TOKEN;
    } else if(env.DEV) {
      (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }

    if (env.VITE_RECAPTCHA_SITE_KEY && !extensionOrigin) {
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

export interface AuthSession {
  uid: string;
  email: string | null;
  displayName: string | null;
  isAnonymous: boolean;
  isGuest: boolean;
}

/** Guest identity used when Firebase credentials are absent (or auth fails). */
const GUEST_KEY = 'pulsebrief.guestId';
const LOCAL_PROFILE_KEY = 'pulsebrief.localProfile';

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

function readLocalProfile(): AuthSession | null {
  try {
    const raw = localStorage.getItem(LOCAL_PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

function writeLocalProfile(session: AuthSession | null): void {
  try {
    if (!session) {
      localStorage.removeItem(LOCAL_PROFILE_KEY);
    } else {
      localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(session));
    }
  } catch {
    /* ignore storage errors */
  }
}

function toAuthSession(user: User | null): AuthSession {
  if (!user) {
    const local = readLocalProfile();
    if (local) return local;
    return {
      uid: getGuestId(),
      email: null,
      displayName: 'Local Guest',
      isAnonymous: true,
      isGuest: true,
    };
  }
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'Signed-in User'),
    isAnonymous: user.isAnonymous,
    isGuest: false,
  };
}

let signInPromise: Promise<string | null> | null = null;

/**
 * Ensures an active uid for persistence. Prefers an already signed-in user,
 * otherwise falls back to anonymous Firebase sign-in or a local guest ID.
 */
export function ensureSignedIn(): Promise<string | null> {
  if (!auth) {
    const local = readLocalProfile();
    return Promise.resolve(local?.uid ?? getGuestId());
  }

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

export async function signInWithGoogleAccount(): Promise<AuthSession> {
  if (!auth) {
    throw new Error('Firebase Auth is not configured in this environment yet.');
  }
  const provider = new GoogleAuthProvider();
  const credential = await signInWithPopup(auth, provider);
  return toAuthSession(credential.user);
}

export async function signInWithEmailAccount(
  email: string,
  password: string,
  createAccount = false,
): Promise<AuthSession> {
  const trimmed = email.trim();
  if (!trimmed || !password) {
    throw new Error('Enter both an email address and password.');
  }
  if (!auth) {
    const localSession: AuthSession = {
      uid: `local_${trimmed.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      email: trimmed,
      displayName: trimmed.split('@')[0],
      isAnonymous: false,
      isGuest: true,
    };
    writeLocalProfile(localSession);
    return localSession;
  }
  const credential = createAccount
    ? await createUserWithEmailAndPassword(auth, trimmed, password)
    : await signInWithEmailAndPassword(auth, trimmed, password);
  return toAuthSession(credential.user);
}

export async function signOutAccount(): Promise<AuthSession> {
  writeLocalProfile(null);
  if (auth) {
    await signOut(auth);
  }
  return toAuthSession(null);
}

/** Observable auth state for header profile & saved-session filtering. */
export function watchAuthSession(callback: (session: AuthSession) => void): () => void {
  if (!auth) {
    callback(toAuthSession(null));
    return () => undefined;
  }
  return onAuthStateChanged(auth, (user) => callback(toAuthSession(user)));
}

export function watchAuth(callback: (uid: string | null) => void): () => void {
  return watchAuthSession((session) => callback(session.uid));
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
  authMode: auth ? 'firebase-auth' : 'local-guest',
  firestore: db ? 'persistent-local-cache' : 'localStorage',
} as const;
