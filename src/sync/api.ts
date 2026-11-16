import type { AppState } from '../domain/types';

/*
 * Thin client for the optional Niyam API. The app is fully usable without it:
 * when no API URL is configured, cloud sync is simply not offered.
 */

const configuredUrl: string | undefined = import.meta.env.VITE_API_URL;
const fallbackUrl = import.meta.env.DEV ? 'http://localhost:8787' : '';

export const API_URL = (configuredUrl ?? fallbackUrl).replace(/\/+$/, '');
export const cloudEnabled = API_URL !== '';

/** A hosted free-tier server can take a while to wake up, so allow a generous wait. */
const REQUEST_TIMEOUT_MS = 70_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string;
}

async function request<T>(path: string, { method = 'GET', body, token }: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(API_URL + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Status 0 marks "never reached the server" (offline, blocked, timed out).
    throw new ApiError(0, 'Could not reach the sync server. Your changes are still saved in this browser.');
  }

  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : `The sync server answered with an error (${response.status}).`;
    throw new ApiError(response.status, message, payload);
  }
  return payload as T;
}

export interface AuthResponse {
  token: string;
  email: string;
}

export interface RemoteState {
  state: AppState | null;
  revision: number;
  feedToken: string;
}

export type AuthMode = 'register' | 'login';

export const api = {
  authenticate: (mode: AuthMode, email: string, password: string) =>
    request<AuthResponse>(`/api/auth/${mode}`, { method: 'POST', body: { email, password } }),
  getState: (token: string) => request<RemoteState>('/api/state', { token }),
  putState: (token: string, state: AppState, baseRevision: number) =>
    request<{ revision: number }>('/api/state', { method: 'PUT', token, body: { state, baseRevision } }),
  deleteAccount: (token: string) => request<null>('/api/account', { method: 'DELETE', token }),
};

export function feedUrl(feedToken: string): string {
  return `${API_URL}/api/feed/${feedToken}.ics`;
}
