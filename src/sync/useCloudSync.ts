import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState } from '../domain/types';
import { parseState } from '../state/store';
import { ApiError, api, type AuthMode } from './api';

const SESSION_KEY = 'niyam.session.v1';

/** Wait for a pause in editing before uploading, so a burst of changes is one request. */
const PUSH_DEBOUNCE_MS = 800;

export interface Session {
  token: string;
  email: string;
  feedToken: string;
  /** The server revision this browser last saw. */
  revision: number;
}

export type SyncStatus = 'off' | 'syncing' | 'synced' | 'error';

function loadSession(): Session | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
    if (typeof value !== 'object' || value === null) return null;
    const { token, email, feedToken, revision } = value as Record<string, unknown>;
    if (typeof token !== 'string' || typeof email !== 'string' || typeof feedToken !== 'string' || typeof revision !== 'number') return null;
    return { token, email, feedToken, revision };
  } catch {
    return null;
  }
}

function storeSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage is blocked; the session simply lasts until the tab closes.
  }
}

/**
 * JSON with object keys in sorted order. A database may return keys in a
 * different order than the browser wrote them, so plain JSON.stringify would
 * report "changed" for identical data.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'object' && item !== null && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

/** Server data is untrusted input like any backup file: validate before it replaces local state. */
function validated(state: AppState | null): AppState | null {
  try {
    return state ? parseState(state) : null;
  } catch {
    return null;
  }
}

interface CloudSyncOptions {
  state: AppState;
  /** Replaces the whole local state with one that came from the server. */
  replaceState: (state: AppState) => void;
  notify: (message: string) => void;
}

/**
 * Keeps local state and the signed-in account in step.
 *
 * The browser stays the place where work happens (local-first): every change
 * is saved locally at once and uploaded shortly after. The server keeps a
 * revision number; if another device saved first, this one adopts that
 * version instead of overwriting it.
 */
export function useCloudSync({ state, replaceState, notify }: CloudSyncOptions) {
  const [session, setSessionState] = useState<Session | null>(loadSession);
  const [status, setStatus] = useState<SyncStatus>(session ? 'syncing' : 'off');
  const [error, setError] = useState('');
  /** True once the first download after sign-in or page load has finished. */
  const [ready, setReady] = useState(false);
  /** Bumped to retry that first download after a failure. */
  const [attempt, setAttempt] = useState(0);
  /** JSON of the state the server is known to hold; anything different needs uploading. */
  const syncedJson = useRef<string | null>(null);
  const sessionRef = useRef(session);

  const setSession = useCallback((next: Session | null) => {
    sessionRef.current = next;
    setSessionState(next);
    storeSession(next);
  }, []);

  const signOut = useCallback(() => {
    setSession(null);
    setReady(false);
    setStatus('off');
    setError('');
    syncedJson.current = null;
  }, [setSession]);

  const fail = useCallback(
    (cause: unknown) => {
      if (cause instanceof ApiError && cause.status === 401) {
        signOut();
        notify('Your session expired. Sign in again to keep syncing.');
        return;
      }
      setStatus('error');
      setError(cause instanceof Error ? cause.message : 'Sync failed.');
    },
    [notify, signOut],
  );

  const adopt = useCallback(
    (remote: AppState, revision: number) => {
      const current = sessionRef.current;
      if (current) setSession({ ...current, revision });
      syncedJson.current = canonicalJson(remote);
      replaceState(remote);
    },
    [replaceState, setSession],
  );

  const push = useCallback(
    async (local: AppState) => {
      const current = sessionRef.current;
      if (!current) return;
      setStatus('syncing');
      try {
        const { revision } = await api.putState(current.token, local, current.revision);
        if (sessionRef.current) setSession({ ...sessionRef.current, revision });
        syncedJson.current = canonicalJson(local);
        setStatus('synced');
        setError('');
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 409) {
          const body = cause.body as { state: AppState | null; revision: number };
          const remote = validated(body.state);
          if (remote) {
            adopt(remote, body.revision);
            setStatus('synced');
            notify('Updated with newer changes from another device');
            return;
          }
        }
        fail(cause);
      }
    },
    [adopt, fail, notify, setSession],
  );

  // On page load with a saved session: fetch what the account holds.
  useEffect(() => {
    const current = sessionRef.current;
    if (!current || ready) return;
    let cancelled = false;
    api
      .getState(current.token)
      .then((remote) => {
        if (cancelled) return;
        const remoteState = validated(remote.state);
        if (remoteState && remote.revision !== current.revision) {
          adopt(remoteState, remote.revision); // another device saved since this browser last synced
        } else {
          syncedJson.current = remoteState ? canonicalJson(remoteState) : null;
        }
        setStatus('synced');
        setReady(true);
      })
      .catch((cause) => !cancelled && fail(cause));
    return () => {
      cancelled = true;
    };
    // Runs once per sign-in; `ready` flips to true when it has finished.
  }, [session?.token, ready, attempt, adopt, fail]);

  // Upload local changes after a short pause.
  useEffect(() => {
    if (!session || !ready || !state.profile) return;
    if (canonicalJson(state) === syncedJson.current) return;
    const timer = window.setTimeout(() => void push(state), PUSH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [state, session, ready, push]);

  /** Creates an account or signs in, then reconciles this browser with the account. */
  const connect = useCallback(
    async (mode: AuthMode, email: string, password: string) => {
      setStatus('syncing');
      setError('');
      try {
        const auth = await api.authenticate(mode, email, password);
        const remote = await api.getState(auth.token);
        setSession({ token: auth.token, email: auth.email, feedToken: remote.feedToken, revision: remote.revision });

        const remoteState = validated(remote.state);
        const localHasData = state.profile !== null;
        const keepLocal =
          remoteState !== null &&
          localHasData &&
          canonicalJson(remoteState) !== canonicalJson(state) &&
          !window.confirm('This account already has saved data. Replace what is in this browser with it?\n\nChoose Cancel to keep this browser’s data and upload it instead.');

        if (remoteState && !keepLocal) adopt(remoteState, remote.revision);
        else syncedJson.current = remoteState ? canonicalJson(remoteState) : null;

        setStatus('synced');
        setReady(true); // the upload effect now sends local data if it differs
        notify(mode === 'register' ? 'Account created. Your calendar now syncs.' : 'Signed in. Your calendar now syncs.');
        return true;
      } catch (cause) {
        // A failed sign-in is not a broken session: stay signed out and show why.
        setStatus('off');
        setError(cause instanceof Error ? cause.message : 'Could not sign in.');
        return false;
      }
    },
    [adopt, notify, setSession, state],
  );

  const deleteAccount = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    try {
      await api.deleteAccount(current.token);
      signOut();
      notify('Account deleted from the server. Data in this browser is unchanged.');
    } catch (cause) {
      fail(cause);
    }
  }, [fail, notify, signOut]);

  const retry = useCallback(() => {
    if (ready) void push(state);
    else setAttempt((count) => count + 1); // re-runs the initial download
    setStatus('syncing');
  }, [push, ready, state]);

  return { session, status, error, connect, signOut, deleteAccount, retry };
}

export type CloudSync = ReturnType<typeof useCloudSync>;
