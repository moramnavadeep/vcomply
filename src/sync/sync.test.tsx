import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { STORAGE_KEY, buildSampleState } from '../state/store';
import { canonicalJson } from './useCloudSync';

/*
 * The browser side of sync, with the network replaced by a scripted fake API.
 * (The real API is tested over HTTP in server/app.test.ts.)
 */

const remoteState = JSON.parse(JSON.stringify(buildSampleState('2026-11-15', '2026-11-15T10:00:00.000Z')));

interface FakeApi {
  state: unknown;
  revision: number;
  loginStatus: number;
  puts: { state: any; baseRevision: number }[];
}

function installFakeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  const fake: FakeApi = { state: null, revision: 0, loginStatus: 200, puts: [], ...overrides };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname;
      if (path.startsWith('/api/auth/')) {
        return fake.loginStatus === 200 ? json(200, { token: 'test-token', email: 'founder@example.com' }) : json(fake.loginStatus, { error: 'Email or password is incorrect.' });
      }
      if (path === '/api/state' && init.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        fake.puts.push(body);
        if (body.baseRevision !== fake.revision) return json(409, { error: 'conflict', state: fake.state, revision: fake.revision });
        fake.state = body.state;
        fake.revision += 1;
        return json(200, { revision: fake.revision });
      }
      if (path === '/api/state') return json(200, { state: fake.state, revision: fake.revision, feedToken: 'feed-token' });
      return json(404, { error: 'Not found.' });
    }),
  );
  return fake;
}

async function signIn(user: ReturnType<typeof userEvent.setup>, button = 'Sign in') {
  await user.type(screen.getByLabelText('Email'), 'founder@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct-horse-battery');
  await user.click(screen.getByRole('button', { name: button }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('canonicalJson', () => {
  it('ignores key order at every depth but not array order', () => {
    expect(canonicalJson({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(canonicalJson({ b: { d: [1, 2], c: 2 }, a: 1 }));
    expect(canonicalJson({ list: [1, 2] })).not.toBe(canonicalJson({ list: [2, 1] }));
  });
});

describe('cloud sync', () => {
  it('brings an existing calendar onto a new device at sign-in', async () => {
    const user = userEvent.setup();
    installFakeApi({ state: remoteState, revision: 4 });
    render(<App />);

    await signIn(user);

    expect(await screen.findByRole('heading', { level: 1, name: 'Kaveri Labs Pvt Ltd' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').profile.name).toBe('Kaveri Labs Pvt Ltd');
  });

  it('shows the server message and stays signed out when sign-in fails', async () => {
    const user = userEvent.setup();
    installFakeApi({ loginStatus: 401 });
    render(<App />);

    await signIn(user);

    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Build my calendar' })).toBeInTheDocument();
  });

  it('keeps working locally when the server cannot be reached', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<App />);

    await signIn(user);

    expect(await screen.findByText(/Could not reach the sync server/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Explore with a sample company' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Kaveri Labs Pvt Ltd' })).toBeInTheDocument();
  });

  it('uploads this browser’s calendar to a new account, then uploads later changes', async () => {
    const user = userEvent.setup();
    const fake = installFakeApi();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Explore with a sample company' }));
    await user.click(screen.getByRole('button', { name: 'Settings & export' }));

    await signIn(user, 'Create account');

    await waitFor(() => expect(fake.puts).toHaveLength(1), { timeout: 3000 });
    expect(fake.puts[0]).toMatchObject({ baseRevision: 0 });
    expect(await screen.findByText('All changes saved to your account')).toBeInTheDocument();
    expect(screen.getByLabelText('Live calendar feed')).toHaveValue('http://localhost:8787/api/feed/feed-token.ics');

    const name = screen.getByLabelText('Company name');
    await user.clear(name);
    await user.type(name, 'Renamed Here');
    await user.click(screen.getByRole('button', { name: 'Save and regenerate calendar' }));

    await waitFor(() => expect(fake.puts).toHaveLength(2), { timeout: 3000 });
    expect(fake.puts[1]).toMatchObject({ baseRevision: 1 });
    expect(fake.puts[1]?.state.profile.name).toBe('Renamed Here');
  });

  it('adopts the newer version when another device saved first', async () => {
    const user = userEvent.setup();
    const fake = installFakeApi();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Explore with a sample company' }));
    await user.click(screen.getByRole('button', { name: 'Settings & export' }));
    await signIn(user, 'Create account');
    await waitFor(() => expect(fake.puts).toHaveLength(1), { timeout: 3000 });

    // Another device saves a renamed company.
    fake.state = { ...remoteState, profile: { ...remoteState.profile, name: 'Renamed On Laptop' } };
    fake.revision = 2;

    const name = screen.getByLabelText('Company name');
    await user.clear(name);
    await user.type(name, 'Renamed Here');
    await user.click(screen.getByRole('button', { name: 'Save and regenerate calendar' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Renamed On Laptop' }, { timeout: 3000 })).toBeInTheDocument();
  });

  it('signs out without touching local data', async () => {
    const user = userEvent.setup();
    installFakeApi({ state: remoteState, revision: 1 });
    render(<App />);
    await signIn(user);
    await screen.findByRole('heading', { level: 1, name: 'Kaveri Labs Pvt Ltd' });

    await user.click(screen.getByRole('button', { name: 'Settings & export' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Kaveri Labs Pvt Ltd' })).toBeInTheDocument();
  });
});
