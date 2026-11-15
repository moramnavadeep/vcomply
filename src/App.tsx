import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { ActivityLog } from './components/ActivityLog';
import { CalendarView } from './components/CalendarView';
import { Dashboard } from './components/Dashboard';
import { ObligationDialog } from './components/ObligationDialog';
import { ProfileForm } from './components/ProfileForm';
import { SettingsView } from './components/SettingsView';
import { financialYearLabel, formatDate, todayIso } from './domain/dates';
import { generateObligations, summarize } from './domain/engine';
import type { AppState, CompanyProfile, IsoDate, Obligation } from './domain/types';
import { buildSampleState, loadState, reducer, saveState } from './state/store';

type View = 'dashboard' | 'calendar' | 'activity' | 'settings';

const VIEWS: { id: View; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings & export' },
];

const TOAST_MS = 4000;

const now = () => new Date().toISOString();

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, () => loadState());
  const [today] = useState<IsoDate>(() => todayIso());
  const [view, setView] = useState<View>('dashboard');
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [storageFailed, setStorageFailed] = useState(false);

  useEffect(() => {
    setStorageFailed(!saveState(state));
  }, [state]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const { profile, completions } = state;
  const hasProfile = profile !== null;

  // Each screen starts at the top, as a page navigation would.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view, hasProfile]);

  const obligations = useMemo(() => (profile ? generateObligations(profile) : []), [profile]);
  const summary = useMemo(() => summarize(obligations, completions, today), [obligations, completions, today]);
  const openObligation = obligations.find((o) => o.id === openId);

  const closeDialog = useCallback(() => setOpenId(null), []);

  function saveProfile(next: CompanyProfile, backfill: boolean) {
    const isNew = profile === null;
    dispatch({ type: 'profile_saved', profile: next, backfill, today, at: now() });
    setToast(isNew ? 'Your compliance calendar is ready' : 'Profile saved and calendar regenerated');
    setView('dashboard');
  }

  function loadSample() {
    dispatch({ type: 'sample_loaded', state: buildSampleState(today, now()) });
    setToast('Sample company loaded. Explore freely; nothing leaves your browser.');
  }

  function fileObligation(obligation: Obligation, filedOn: IsoDate, reference: string, note: string) {
    dispatch({ type: 'filed', obligation, filedOn, reference, note, at: now() });
    setOpenId(null);
    setToast(`${obligation.form} for ${obligation.periodLabel} marked as filed`);
  }

  function reopenObligation(obligation: Obligation) {
    dispatch({ type: 'reopened', obligation, at: now() });
    setToast(`${obligation.form} for ${obligation.periodLabel} reopened`);
  }

  function importState(imported: AppState) {
    dispatch({ type: 'imported', state: imported, at: now() });
    setToast('Backup restored');
    setView('dashboard');
  }

  function reset() {
    dispatch({ type: 'reset' });
    setView('dashboard');
    setToast('All data deleted');
  }

  const storageWarning = storageFailed && (
    <p className="banner banner-warn" role="alert">
      Your browser is blocking storage, so changes will be lost when you close this tab. Download a backup from Settings to keep them.
    </p>
  );

  if (!profile) {
    return (
      <>
        <Welcome today={today} onSubmit={saveProfile} onLoadSample={loadSample} warning={storageWarning} />
        <Toast message={toast} />
      </>
    );
  }

  return (
    <div className="app">
      <header className="topbar no-print">
        <div className="topbar-inner">
          <Brand />
          <nav aria-label="Main">
            {VIEWS.map(({ id, label }) => (
              <button key={id} type="button" className={view === id ? 'is-active' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>
                {label}
                {id === 'dashboard' && summary.overdue > 0 && <span className="nav-dot" aria-label={`${summary.overdue} overdue`} />}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="page">
        {storageWarning}
        <div className="page-heading">
          <h1>{profile.name}</h1>
          <p>
            {profile.entityType === 'llp' ? 'LLP' : 'Private limited company'} · Apr {profile.complianceYear} – Mar {profile.complianceYear + 1} ({financialYearLabel(profile.complianceYear)}) · as of {formatDate(today)}
          </p>
        </div>

        {view === 'dashboard' && (
          <Dashboard obligations={obligations} completions={completions} summary={summary} today={today} onOpen={(o) => setOpenId(o.id)} onViewCalendar={() => setView('calendar')} />
        )}
        {view === 'calendar' && <CalendarView obligations={obligations} completions={completions} today={today} onOpen={(o) => setOpenId(o.id)} />}
        {view === 'activity' && <ActivityLog activity={state.activity} />}
        {view === 'settings' && (
          <SettingsView state={state} profile={profile} obligations={obligations} today={today} onSaveProfile={saveProfile} onImport={importState} onReset={reset} notify={setToast} />
        )}
      </main>

      {openObligation && (
        <ObligationDialog
          key={openObligation.id}
          obligation={openObligation}
          completion={completions[openObligation.id]}
          today={today}
          onFile={fileObligation}
          onReopen={reopenObligation}
          onClose={closeDialog}
        />
      )}
      <Toast message={toast} />
    </div>
  );
}

function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">✓</span>
      Niyam
    </span>
  );
}

function Toast({ message }: { message: string }) {
  return (
    <div className="toast-region no-print" role="status" aria-live="polite">
      {message && <div className="toast">{message}</div>}
    </div>
  );
}

interface WelcomeProps {
  today: IsoDate;
  onSubmit: (profile: CompanyProfile, backfill: boolean) => void;
  onLoadSample: () => void;
  warning: React.ReactNode;
}

function Welcome({ today, onSubmit, onLoadSample, warning }: WelcomeProps) {
  return (
    <main className="welcome">
      <section className="welcome-pitch">
        <Brand />
        <h1>Never pay a late fee for a deadline you did not know about.</h1>
        <p className="lede">
          Answer a few questions about your company and get every GST, TDS, PF, income-tax and MCA deadline that applies to you for the year, with the reason it applies and what being late costs.
        </p>
        <ul className="points">
          <li><strong>Personalised.</strong> Only filings that apply to your company, each with a plain-language reason.</li>
          <li><strong>Priced.</strong> See late fees add up in rupees, day by day.</li>
          <li><strong>Audit-ready.</strong> Record acknowledgement numbers and keep a log of every change.</li>
          <li><strong>Private.</strong> No sign-up. Your data stays in this browser.</li>
        </ul>
        <button type="button" className="btn btn-on-dark" onClick={onLoadSample}>Explore with a sample company</button>
      </section>
      <section className="welcome-form">
        {warning}
        <h2>Build your calendar</h2>
        <p className="card-intro">Takes about a minute. You can change any answer later.</p>
        <ProfileForm initial={null} today={today} submitLabel="Build my calendar" onSubmit={onSubmit} />
      </section>
    </main>
  );
}
