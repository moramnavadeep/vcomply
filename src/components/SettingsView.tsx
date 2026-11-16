import { useRef, useState, type ChangeEvent } from 'react';
import type { AppState, CompanyProfile, IsoDate, Obligation } from '../domain/types';
import { RULESET_VERSION } from '../domain/rules';
import { buildRegisterCsv } from '../export/csv';
import { downloadFile, slugify } from '../export/download';
import { buildIcs } from '../export/ics';
import { parseState } from '../state/store';
import { cloudEnabled } from '../sync/api';
import type { CloudSync } from '../sync/useCloudSync';
import { CloudSyncCard } from './CloudSyncCard';
import { ProfileForm } from './ProfileForm';

/** Backups are a few kilobytes; anything far larger is not one of ours. */
const MAX_BACKUP_BYTES = 2_000_000;

/** Byte-order mark: makes Excel read the rupee sign and dashes in the CSV as UTF-8. */
const UTF8_BOM = '﻿';

interface SettingsViewProps {
  state: AppState;
  profile: CompanyProfile;
  obligations: Obligation[];
  today: IsoDate;
  onSaveProfile: (profile: CompanyProfile, backfill: boolean) => void;
  onImport: (state: AppState) => void;
  onReset: () => void;
  notify: (message: string) => void;
  sync: CloudSync;
}

export function SettingsView({ state, profile, obligations, today, onSaveProfile, onImport, onReset, notify, sync }: SettingsViewProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState('');
  const slug = slugify(profile.name);
  const openObligations = obligations.filter((o) => !state.completions[o.id]);

  function exportCalendar() {
    downloadFile(`${slug}-compliance.ics`, buildIcs(openObligations, profile.name), 'text/calendar;charset=utf-8');
    notify(`Calendar file with ${openObligations.length} open deadlines downloaded`);
  }

  function exportRegister() {
    downloadFile(`${slug}-compliance-register.csv`, UTF8_BOM + buildRegisterCsv(obligations, state.completions, today), 'text/csv;charset=utf-8');
    notify('Compliance register downloaded');
  }

  function exportBackup() {
    downloadFile(`${slug}-niyam-backup.json`, JSON.stringify(state, null, 2), 'application/json');
    notify('Backup downloaded');
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow choosing the same file again after an error
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('This file is too large to be a Niyam backup.');
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error('This file is not valid JSON, so it cannot be a Niyam backup.');
      }
      const imported = parseState(data);
      if (!imported.profile) throw new Error('This backup does not contain a company profile.');
      setImportError('');
      onImport(imported);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'The backup could not be read.');
    }
  }

  function handleReset() {
    if (window.confirm('Delete the company profile, all filing records and the activity log from this browser? This cannot be undone.')) {
      onReset();
    }
  }

  return (
    <div className="stack">
      {cloudEnabled && (
        <CloudSyncCard sync={sync} intro="Optional. Create an account to use this calendar on more than one device and to get a calendar feed that updates itself. Without an account, everything stays in this browser." />
      )}

      <section className="card">
        <header className="card-header"><h2>Export</h2></header>
        <p className="card-intro">Take your deadlines to the tools you already use, or hand your accountant a register.</p>
        <div className="actions">
          <ExportAction title="Add to my calendar" detail="An .ics file for Google Calendar or Outlook, with a reminder 3 days before each open deadline." button="Download .ics" onClick={exportCalendar} />
          <ExportAction title="Compliance register" detail="A spreadsheet of every filing with its status, filing date and acknowledgement number." button="Download .csv" onClick={exportRegister} />
          <ExportAction title="Backup" detail="Everything in one file. Restore it in another browser or on another device." button="Download backup" onClick={exportBackup} />
        </div>
      </section>

      <section className="card">
        <header className="card-header"><h2>Restore from backup</h2></header>
        <p className="card-intro">Replaces what is in this browser with the contents of a backup file.</p>
        <input ref={fileInput} type="file" accept="application/json,.json" className="visually-hidden" onChange={handleImport} aria-label="Backup file" />
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>Choose backup file</button>
        {importError && <p className="field-error" role="alert">{importError}</p>}
      </section>

      <section className="card">
        <header className="card-header"><h2>Company profile</h2></header>
        <p className="card-intro">Changing an answer regenerates the calendar. Filings you have already recorded are kept.</p>
        <ProfileForm key={JSON.stringify(profile)} initial={profile} today={today} submitLabel="Save and regenerate calendar" onSubmit={onSaveProfile} />
      </section>

      <section className="card">
        <header className="card-header"><h2>Start over</h2></header>
        <p className="card-intro">Your data lives only in this browser. Deleting it here removes it for good.</p>
        <button type="button" className="btn btn-danger" onClick={handleReset}>Delete all data</button>
      </section>

      <p className="fine-print">Rule set {RULESET_VERSION}. Niyam is a tracking aid, not legal or tax advice; confirm dates with your CA or CS.</p>
    </div>
  );
}

function ExportAction({ title, detail, button, onClick }: { title: string; detail: string; button: string; onClick: () => void }) {
  return (
    <div className="action">
      <div>
        <p className="action-title">{title}</p>
        <p className="action-detail">{detail}</p>
      </div>
      <button type="button" className="btn" onClick={onClick}>{button}</button>
    </div>
  );
}
