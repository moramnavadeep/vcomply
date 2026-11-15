import { useEffect, useRef, useState, type FormEvent } from 'react';
import { daysBetween, formatDate, formatInr, isValidIsoDate } from '../domain/dates';
import { estimatePenalty, getStatus } from '../domain/engine';
import type { Completion, IsoDate, Obligation } from '../domain/types';
import { StatusBadge, plural, statusDetail } from './common';

interface ObligationDialogProps {
  obligation: Obligation;
  completion: Completion | undefined;
  today: IsoDate;
  onFile: (obligation: Obligation, filedOn: IsoDate, reference: string, note: string) => void;
  onReopen: (obligation: Obligation) => void;
  onClose: () => void;
}

export function ObligationDialog({ obligation, completion, today, onFile, onReopen, onClose }: ObligationDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const status = getStatus(obligation, completion, today);

  // Move focus into the dialog, close on Escape, and hand focus back afterwards.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabIndex={-1} ref={dialogRef}>
        <header className="dialog-header">
          <div>
            <p className="eyebrow">{obligation.category} · {obligation.authority}</p>
            <h2 id="dialog-title">{obligation.title}</h2>
          </div>
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="dialog-body">
          <p className="dialog-status">
            <StatusBadge status={status} />
            <span>{statusDetail(obligation, completion, today)}</span>
          </p>

          <dl className="facts">
            <div><dt>Period</dt><dd>{obligation.periodLabel}</dd></div>
            <div><dt>Due date</dt><dd>{formatDate(obligation.dueDate)}</dd></div>
            <div><dt>Form</dt><dd>{obligation.form}</dd></div>
          </dl>

          <h3>What it is</h3>
          <p>{obligation.description}</p>
          <h3>Why it applies to you</h3>
          <p>{obligation.reason}</p>
          <h3>If it is late</h3>
          <p>{obligation.penalty.note}</p>

          {completion ? (
            <FiledRecord obligation={obligation} completion={completion} onReopen={onReopen} />
          ) : (
            <FileForm obligation={obligation} today={today} onFile={onFile} />
          )}
        </div>
      </div>
    </div>
  );
}

function FiledRecord({ obligation, completion, onReopen }: { obligation: Obligation; completion: Completion; onReopen: (o: Obligation) => void }) {
  return (
    <section className="record">
      <h3>Filing record</h3>
      <dl className="facts">
        <div><dt>Filed on</dt><dd>{completion.backfilled ? 'Before tracking began' : formatDate(completion.filedOn)}</dd></div>
        <div><dt>Reference</dt><dd>{completion.reference || 'Not recorded'}</dd></div>
        {completion.note && <div><dt>Note</dt><dd>{completion.note}</dd></div>}
      </dl>
      <button type="button" className="btn" onClick={() => onReopen(obligation)}>Reopen this filing</button>
    </section>
  );
}

function FileForm({ obligation, today, onFile }: { obligation: Obligation; today: IsoDate; onFile: ObligationDialogProps['onFile'] }) {
  const [filedOn, setFiledOn] = useState(today);
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const dateIsValid = isValidIsoDate(filedOn);
  const lateDays = dateIsValid ? Math.max(0, daysBetween(obligation.dueDate, filedOn)) : 0;
  const fee = estimatePenalty(obligation.penalty, lateDays);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!dateIsValid) return setError('Enter the date it was filed.');
    if (filedOn > today) return setError('The filing date cannot be in the future.');
    setError('');
    onFile(obligation, filedOn, reference, note);
  }

  return (
    <form className="form record" onSubmit={handleSubmit} noValidate>
      <h3>Record the filing</h3>
      <div className="field-grid">
        <div className="field">
          <label htmlFor="file-date">Filed on</label>
          <input id="file-date" type="date" value={filedOn} max={today} onChange={(e) => setFiledOn(e.target.value)} aria-invalid={!!error} aria-describedby={error ? 'file-date-error' : undefined} />
          {error && <p className="field-error" id="file-date-error">{error}</p>}
        </div>
        <div className="field">
          <label htmlFor="file-ref">Acknowledgement number <span className="optional">optional</span></label>
          <input id="file-ref" type="text" placeholder="ARN / SRN / challan no." value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="file-note">Note <span className="optional">optional</span></label>
        <input id="file-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </div>

      {lateDays > 0 && filedOn <= today && (
        <p className="late-warning" role="status">
          This will be recorded as {plural(lateDays, 'day')} late.{' '}
          {fee === null ? 'Interest applies on the amount due.' : `Indicative late fee: ${formatInr(fee)}.`}
        </p>
      )}

      <button type="submit" className="btn btn-primary">Mark as filed</button>
    </form>
  );
}
