import { daysLate, estimatePenalty, getStatus } from '../domain/engine';
import type { Completion, IsoDate, Obligation, Status } from '../domain/types';

export const STATUS_LABELS: Record<Status, string> = {
  filed: 'Filed',
  filed_late: 'Filed late',
  overdue: 'Overdue',
  due_soon: 'Due soon',
  upcoming: 'Upcoming',
};

/**
 * Quotes a cell for CSV. Cells starting with = + - @ are prefixed with an
 * apostrophe so a spreadsheet never executes user-typed text as a formula.
 */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The compliance register: one row per obligation with its filing evidence. */
export function buildRegisterCsv(
  obligations: Obligation[],
  completions: Record<string, Completion>,
  today: IsoDate,
): string {
  const header = ['Due date', 'Category', 'Form', 'Obligation', 'Period', 'Status', 'Filed on', 'Days late', 'Reference', 'Note', 'Indicative late fee (INR)'];

  const rows = obligations.map((obligation) => {
    const completion = completions[obligation.id];
    const late = daysLate(obligation, completion, today);
    const fee = estimatePenalty(obligation.penalty, late);
    return [
      obligation.dueDate,
      obligation.category,
      obligation.form,
      obligation.title,
      obligation.periodLabel,
      STATUS_LABELS[getStatus(obligation, completion, today)],
      completion?.filedOn ?? '',
      late,
      completion?.reference ?? '',
      completion?.note ?? '',
      fee === null ? 'Depends on amount due' : fee,
    ];
  });

  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
