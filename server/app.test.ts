// @vitest-environment node
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSampleState } from '../src/state/store';
import { createApp } from './app';
import { hashPassword, signToken, verifyPassword, verifyToken } from './auth';
import { MemoryStore } from './store';

/*
 * Tests drive the real Express app over HTTP on a random port, with the
 * in-memory store standing in for Postgres.
 */

const SECRET = 'test-secret';
const ALLOWED_ORIGIN = 'https://app.example';
const state = JSON.parse(JSON.stringify(buildSampleState('2026-11-15', '2026-11-15T10:00:00.000Z')));

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  const app = createApp(new MemoryStore(), { jwtSecret: SECRET, allowedOrigins: [ALLOWED_ORIGIN], authAttemptsPerWindow: 5 });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

interface CallOptions {
  method?: string;
  body?: unknown;
  token?: string;
  headers?: Record<string, string>;
}

async function call(path: string, { method = 'GET', body, token, headers = {} }: CallOptions = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON (calendar feed, empty body)
  }
  return { status: response.status, json, text, headers: response.headers };
}

async function register(email = 'founder@example.com', password = 'correct-horse-battery') {
  const response = await call('/api/auth/register', { method: 'POST', body: { email, password } });
  return response.json.token as string;
}

describe('password hashing and tokens', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(hash).not.toContain('correct-horse-battery');
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('salts every hash differently', async () => {
    expect(await hashPassword('same-password')).not.toBe(await hashPassword('same-password'));
  });

  it('rejects a malformed stored hash instead of throwing', async () => {
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
  });

  it('rejects tokens that are tampered with or signed with another secret', () => {
    const token = signToken('user-1', SECRET);
    expect(verifyToken(token, SECRET)).toBe('user-1');
    expect(verifyToken(token, 'other-secret')).toBeNull();
    expect(verifyToken(`${token}x`, SECRET)).toBeNull();
    expect(verifyToken('garbage', SECRET)).toBeNull();
  });
});

describe('accounts', () => {
  it('reports health', async () => {
    expect((await call('/api/health')).json).toEqual({ ok: true });
  });

  it('registers, then signs in with the same credentials', async () => {
    const created = await call('/api/auth/register', { method: 'POST', body: { email: ' Founder@Example.com ', password: 'correct-horse-battery' } });
    expect(created.status).toBe(201);
    expect(created.json.email).toBe('founder@example.com');

    const login = await call('/api/auth/login', { method: 'POST', body: { email: 'founder@example.com', password: 'correct-horse-battery' } });
    expect(login.status).toBe(200);
    expect(typeof login.json.token).toBe('string');
  });

  it.each([
    ['a missing email', { password: 'correct-horse-battery' }],
    ['a malformed email', { email: 'not-an-email', password: 'correct-horse-battery' }],
    ['a short password', { email: 'a@b.co', password: 'short' }],
    ['a non-string password', { email: 'a@b.co', password: 12345678 }],
  ])('rejects registration with %s', async (_label, body) => {
    expect((await call('/api/auth/register', { method: 'POST', body })).status).toBe(400);
  });

  it('refuses a second account with the same email, ignoring case', async () => {
    await register('founder@example.com');
    const again = await call('/api/auth/register', { method: 'POST', body: { email: 'FOUNDER@example.com', password: 'another-password' } });
    expect(again.status).toBe(409);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    await register();
    const wrongPassword = await call('/api/auth/login', { method: 'POST', body: { email: 'founder@example.com', password: 'wrong-password' } });
    const unknownEmail = await call('/api/auth/login', { method: 'POST', body: { email: 'nobody@example.com', password: 'wrong-password' } });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.json).toEqual(unknownEmail.json);
  });

  it('never returns the password hash', async () => {
    const token = await register();
    const responses = [await call('/api/state', { token }), await call('/api/auth/login', { method: 'POST', body: { email: 'founder@example.com', password: 'correct-horse-battery' } })];
    for (const response of responses) expect(response.text).not.toMatch(/scrypt|passwordHash|password_hash/);
  });

  it('locks out repeated sign-in attempts', async () => {
    const attempt = () => call('/api/auth/login', { method: 'POST', body: { email: 'founder@example.com', password: 'guess' } });
    for (let i = 0; i < 5; i += 1) expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);
  });

  it('deletes the account and everything stored with it', async () => {
    const token = await register();
    expect((await call('/api/account', { method: 'DELETE', token })).status).toBe(204);
    expect((await call('/api/state', { token })).status).toBe(401);
    expect((await call('/api/auth/login', { method: 'POST', body: { email: 'founder@example.com', password: 'correct-horse-battery' } })).status).toBe(401);
  });
});

describe('state sync', () => {
  it('requires a valid token', async () => {
    expect((await call('/api/state')).status).toBe(401);
    expect((await call('/api/state', { token: 'garbage' })).status).toBe(401);
    expect((await call('/api/state', { method: 'PUT', body: { state, baseRevision: 0 } })).status).toBe(401);
  });

  it('starts empty, then saves and returns state', async () => {
    const token = await register();
    const empty = await call('/api/state', { token });
    expect(empty.json).toMatchObject({ state: null, revision: 0 });

    const saved = await call('/api/state', { method: 'PUT', token, body: { state, baseRevision: 0 } });
    expect(saved.json).toEqual({ revision: 1 });

    const loaded = await call('/api/state', { token });
    expect(loaded.json.state).toEqual(state);
    expect(loaded.json.revision).toBe(1);
  });

  it('rejects a save based on a stale revision and returns the newer state', async () => {
    const token = await register();
    await call('/api/state', { method: 'PUT', token, body: { state, baseRevision: 0 } });

    const renamed = { ...state, profile: { ...state.profile, name: 'Saved from the other device' } };
    const stale = await call('/api/state', { method: 'PUT', token, body: { state: renamed, baseRevision: 0 } });
    expect(stale.status).toBe(409);
    expect(stale.json.revision).toBe(1);
    expect(stale.json.state.profile.name).toBe(state.profile.name);
  });

  it.each([
    ['state of the wrong shape', { state: { version: 1 }, baseRevision: 0 }],
    ['an unsupported version', { state: { ...state, version: 2 }, baseRevision: 0 }],
    ['a missing revision', { state }],
    ['a non-integer revision', { state, baseRevision: '0' }],
  ])('rejects %s', async (_label, body) => {
    const token = await register();
    expect((await call('/api/state', { method: 'PUT', token, body })).status).toBe(400);
  });

  it('keeps each account separate', async () => {
    const first = await register('first@example.com');
    const second = await register('second@example.com');
    await call('/api/state', { method: 'PUT', token: first, body: { state, baseRevision: 0 } });
    expect((await call('/api/state', { token: second })).json.state).toBeNull();
  });

  it('answers malformed JSON with 400, not a crash', async () => {
    const token = await register();
    const response = await call('/api/state', { method: 'PUT', token, body: '{not json', headers: { 'Content-Type': 'application/json' } });
    expect(response.status).toBe(400);
    expect((await call('/api/health')).status).toBe(200);
  });

  it('refuses oversized bodies', async () => {
    const token = await register();
    const huge = { state: { ...state, activity: [{ id: 'a', at: 'x', type: 'filed', message: 'x'.repeat(400_000) }] }, baseRevision: 0 };
    expect((await call('/api/state', { method: 'PUT', token, body: huge })).status).toBe(413);
  });
});

describe('calendar feed', () => {
  async function feedPath(token: string) {
    return `/api/feed/${(await call('/api/state', { token })).json.feedToken}.ics`;
  }

  it('serves only open obligations, without a login', async () => {
    const token = await register();
    await call('/api/state', { method: 'PUT', token, body: { state, baseRevision: 0 } });

    const feed = await call(await feedPath(token));
    expect(feed.status).toBe(200);
    expect(feed.headers.get('content-type')).toContain('text/calendar');
    const events = feed.text.split('\r\n').filter((line) => line === 'BEGIN:VEVENT').length;
    expect(events).toBe(75 - Object.keys(state.completions).length);
    expect(feed.text).toContain('Kaveri Labs Pvt Ltd');
  });

  it('drops an obligation from the feed once it is filed', async () => {
    const token = await register();
    await call('/api/state', { method: 'PUT', token, body: { state, baseRevision: 0 } });
    const path = await feedPath(token);
    expect((await call(path)).text).toContain('UID:gstr1-monthly:2026-10@niyam');

    const filed = { ...state, completions: { ...state.completions, 'gstr1-monthly:2026-10': { filedOn: '2026-11-15', reference: '', note: '', backfilled: false } } };
    await call('/api/state', { method: 'PUT', token, body: { state: filed, baseRevision: 1 } });
    expect((await call(path)).text).not.toContain('UID:gstr1-monthly:2026-10@niyam');
  });

  it('serves a valid empty calendar before any data is saved', async () => {
    const token = await register();
    const feed = await call(await feedPath(token));
    expect(feed.status).toBe(200);
    expect(feed.text).toContain('BEGIN:VCALENDAR');
    expect(feed.text).not.toContain('BEGIN:VEVENT');
  });

  it('returns 404 for an unknown token or wrong extension', async () => {
    expect((await call('/api/feed/not-a-real-token.ics')).status).toBe(404);
    expect((await call('/api/feed/whatever')).status).toBe(404);
  });
});

describe('CORS and routing', () => {
  it('allows the configured origin and no other', async () => {
    const allowed = await call('/api/health', { headers: { Origin: ALLOWED_ORIGIN } });
    const other = await call('/api/health', { headers: { Origin: 'https://evil.example' } });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers preflight requests', async () => {
    const response = await call('/api/state', { method: 'OPTIONS', headers: { Origin: ALLOWED_ORIGIN } });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
  });

  it('returns JSON 404 for unknown routes', async () => {
    const response = await call('/api/nope');
    expect(response.status).toBe(404);
    expect(response.json.error).toBeTruthy();
  });
});
