import { daysBetween, formatDate, monthName } from '../domain/dates';
import { getStatus } from '../domain/engine';
import type { Completion, IsoDate, Obligation, Status } from '../domain/types';
import { STATUS_LABELS } from '../export/csv';

/** Short, human description of where an obligation stands relative to today. */
export function statusDetail(obligation: Obligation, completion: Completion | undefined, today: IsoDate): string {
  if (completion) {
    if (completion.backfilled) return 'Assumed filed';
    const late = daysBetween(obligation.dueDate, completion.filedOn);
    return late > 0 ? `Filed ${formatDate(completion.filedOn)}, ${plural(late, 'day')} late` : `Filed ${formatDate(completion.filedOn)}`;
  }
  const daysLeft = daysBetween(today, obligation.dueDate);
  if (daysLeft < 0) return `${plural(-daysLeft, 'day')} overdue`;
  if (daysLeft === 0) return 'Due today';
  if (daysLeft === 1) return 'Due tomorrow';
  return `Due in ${daysLeft} days`;
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status]}</span>;
}

interface ObligationRowProps {
  obligation: Obligation;
  completion: Completion | undefined;
  today: IsoDate;
  onOpen: (obligation: Obligation) => void;
}

/** One obligation as a clickable row; used by both the dashboard and the calendar. */
export function ObligationRow({ obligation, completion, today, onOpen }: ObligationRowProps) {
  const status = getStatus(obligation, completion, today);
  const [, month, day] = obligation.dueDate.split('-').map(Number) as [number, number, number];

  return (
    <li>
      <button type="button" className={`row row-${status}`} onClick={() => onOpen(obligation)}>
        <span className="row-date" aria-hidden="true">
          <span className="row-day">{day}</span>
          <span className="row-month">{monthName(month).slice(0, 3)}</span>
        </span>
        <span className="row-main">
          <span className="row-title">{obligation.title}</span>
          <span className="row-meta">
            {obligation.category} · {obligation.periodLabel}
            <span className="visually-hidden">, due {formatDate(obligation.dueDate)}</span>
          </span>
        </span>
        <span className="row-status">
          <StatusBadge status={status} />
          <span className="row-detail">{statusDetail(obligation, completion, today)}</span>
        </span>
      </button>
    </li>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <p>{children}</p>}
    </div>
  );
}
