import { useState, type FormEvent } from 'react';
import { feedUrl, type AuthMode } from '../sync/api';
import type { CloudSync, SyncStatus } from '../sync/useCloudSync';

const STATUS_TEXT: Record<SyncStatus, string> = {
  off: 'Not signed in',
  syncing: 'Syncing…',
  synced: 'All changes saved to your account',
  error: 'Not synced',
};

interface CloudSyncCardProps {
  sync: CloudSync;
  /** Shown above the sign-in form; differs between the welcome screen and settings. */
  intro: string;
}

/** Optional accounts: sign in to sync across devices and get a live calendar feed. */
export function CloudSyncCard({ sync, intro }: CloudSyncCardProps) {
  return (
    <section className="card">
      <header className="card-header">
        <h2>Sync across devices</h2>
        {sync.session && <span className={`count sync-${sync.status}`}>{STATUS_TEXT[sync.status]}</span>}
      </header>
      {sync.session ? <SignedIn sync={sync} /> : <SignInForm sync={sync} intro={intro} />}
    </section>
  );
}

function SignInForm({ sync, intro }: CloudSyncCardProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const busy = sync.status === 'syncing';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // Which of the two submit buttons was pressed decides between signing in and signing up.
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const mode: AuthMode = submitter?.value === 'register' ? 'register' : 'login';
    await sync.connect(mode, email, password);
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <p className="card-intro">{intro}</p>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="sync-email">Email</label>
          <input id="sync-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </div>
        <div className="field">
          <label htmlFor="sync-password">Password</label>
          <input id="sync-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" minLength={8} required />
        </div>
      </div>
      {sync.error && <p className="field-error" role="alert">{sync.error}</p>}
      {busy && <p className="card-intro" role="status">Connecting. The server can take up to a minute to wake up.</p>}
      <div className="button-row">
        <button type="submit" className="btn btn-primary" disabled={busy} value="login">Sign in</button>
        <button type="submit" className="btn" disabled={busy} value="register">Create account</button>
      </div>
    </form>
  );
}

function SignedIn({ sync }: { sync: CloudSync }) {
  const [copied, setCopied] = useState(false);
  if (!sync.session) return null;
  const url = feedUrl(sync.session.feedToken);

  async function copyFeedUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false); // clipboard blocked: the field is selectable, so the user can copy by hand
    }
  }

  function handleDelete() {
    if (window.confirm('Delete your account and its data from the server? Data in this browser is kept. This cannot be undone.')) {
      void sync.deleteAccount();
    }
  }

  return (
    <div className="form">
      <p className="card-intro">
        Signed in as <strong>{sync.session.email}</strong>. Changes upload automatically and appear on your other devices.
      </p>
      {sync.status === 'error' && (
        <p className="field-error" role="alert">
          {sync.error} <button type="button" className="btn btn-link" onClick={sync.retry}>Try again</button>
        </p>
      )}

      <div className="field">
        <label htmlFor="sync-feed">Live calendar feed</label>
        <div className="input-row">
          <input id="sync-feed" type="text" readOnly value={url} onFocus={(e) => e.target.select()} />
          <button type="button" className="btn" onClick={copyFeedUrl}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <p className="hint">
          Subscribe to this address in Google Calendar or Outlook ("add calendar from URL"). Unlike a downloaded file it stays current: filings you record disappear from your calendar. Anyone with the address can see your deadlines, so share it only with people who should.
        </p>
      </div>

      <div className="button-row">
        <button type="button" className="btn" onClick={sync.signOut}>Sign out</button>
        <button type="button" className="btn btn-danger" onClick={handleDelete}>Delete account</button>
      </div>
    </div>
  );
}
