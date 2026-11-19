import { collection, doc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore';
import { db, ensureSignedIn, isFirebaseConfigured } from '../config/firebase';
import type { PostCallBrief, SyncStatus } from '../types/session';

/**
 * Session persistence.
 *
 * Firestore is the source of truth when configured, with IndexedDB persistence
 * enabled in `config/firebase.ts` — so a brief captured while offline is written
 * to the local cache, appears immediately, and is flushed by the SDK on reconnect.
 *
 * `localStorage` is the always-available fallback so the demo never loses work,
 * even with no Firebase project, or in private-browsing modes where IndexedDB
 * multi-tab locking is unavailable.
 */

const LS_KEY = 'pulsebrief.sessions.v1';
const COLLECTION = 'sessions';

export interface StoredSession {
  id: string;
  savedAt: string;
  brief: PostCallBrief;
}

function readLocal(): StoredSession[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal(sessions: StoredSession[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(sessions.slice(0, 24)));
  } catch (error) {
    console.warn('[PulseBrief] localStorage write failed (quota or private mode).', error);
  }
}

export function listLocalSessions(): StoredSession[] {
  return readLocal();
}

/**
 * Persist a brief. Returns the sync status the UI shows in the telemetry receipt.
 * Offline writes still land in the local cache and are queued by the SDK.
 */
export async function saveSession(brief: PostCallBrief): Promise<SyncStatus> {
  const id = `session_${Date.now()}_${brief.title.slice(0, 12).replace(/\W+/g, '')}`;
  const record: StoredSession = { id, savedAt: new Date().toISOString(), brief };

  writeLocal([record, ...readLocal()]);

  if (!isFirebaseConfigured || !db) return 'LOCAL_ONLY';

  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'QUEUED_OFFLINE';

  try {
    const uid = await ensureSignedIn();
    if (!uid) return 'LOCAL_ONLY';
    await setDoc(doc(db, COLLECTION, id), {
      ownerUid: uid,
      savedAt: record.savedAt,
      title: brief.title,
      brief,
    });
    return 'SYNCED';
  } catch (error) {
    console.warn('[PulseBrief] Firestore write queued locally — will retry when online.', error);
    return 'QUEUED_OFFLINE';
  }
}

/** Recent briefs for the current identity (best-effort; local cache always works). */
export async function listSessions(ownerUid?: string): Promise<StoredSession[]> {
  if (!isFirebaseConfigured || !db || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return readLocal();
  }
  try {
    const snapshot = await getDocs(
      query(collection(db, COLLECTION), orderBy('savedAt', 'desc'), limit(10)),
    );
    const remote = snapshot.docs
      .map((entry) => {
        const data = entry.data() as { savedAt?: string; brief?: PostCallBrief; ownerUid?: string };
        if (!data.brief) return null;
        if (ownerUid && data.ownerUid && data.ownerUid !== ownerUid) return null;
        return { id: entry.id, savedAt: data.savedAt ?? data.brief.createdAt, brief: data.brief };
      })
      .filter((entry): entry is StoredSession => entry !== null);

    return remote.length > 0 ? remote : readLocal();
  } catch (error) {
    console.warn('[PulseBrief] Firestore read failed — showing local sessions.', error);
    return readLocal();
  }
}

export const syncStatusLabel: Record<SyncStatus, string> = {
  SYNCED: 'Synced to Cloud Firestore',
  QUEUED_OFFLINE: 'Queued offline in IndexedDB',
  LOCAL_ONLY: 'Stored locally in this browser',
  SAVING: 'Writing session…',
};
