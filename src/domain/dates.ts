import type { IsoDate } from './types';

/*
 * All date maths runs on UTC midnights. Statutory deadlines are calendar dates,
 * so using local time would let daylight-saving or time-zone offsets shift a
 * due date by a day.
 */

const MS_PER_DAY = 86_400_000;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Builds an ISO date. `month` is 1-12. Rejects impossible dates such as 31 June. */
export function isoDate(year: number, month: number, day: number): IsoDate {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new RangeError(`Invalid calendar date: ${year}-${month}-${day}`);
  }
  return date.toISOString().slice(0, 10);
}

export function isValidIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function toUtc(date: IsoDate): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / MS_PER_DAY);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(toUtc(date) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Today's date in the user's own time zone. */
export function todayIso(now: Date = new Date()): IsoDate {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function monthName(month: number): string {
  const name = MONTH_NAMES[month - 1];
  if (!name) throw new RangeError(`Invalid month: ${month}`);
  return name;
}

/** "2026-11-20" -> "20 Nov 2026" */
export function formatDate(date: IsoDate): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return `${day} ${monthName(month).slice(0, 3)} ${year}`;
}

/** "2026-11-20" -> "November 2026" */
export function formatMonthYear(date: IsoDate): string {
  const [year, month] = date.split('-').map(Number) as [number, number];
  return `${monthName(month)} ${year}`;
}

/** Indian financial year label: 2026 -> "FY 2026-27". */
export function financialYearLabel(startYear: number): string {
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** Start year of the April–March window containing `date`. */
export function complianceYearOf(date: IsoDate): number {
  const [year, month] = date.split('-').map(Number) as [number, number];
  return month >= 4 ? year : year - 1;
}

export interface YearMonth {
  year: number;
  month: number;
}

/** The twelve months April `startYear` … March `startYear + 1`, in order. */
export function monthsOfComplianceYear(startYear: number): YearMonth[] {
  return Array.from({ length: 12 }, (_, index) => {
    const month = ((index + 3) % 12) + 1;
    return { year: month >= 4 ? startYear : startYear + 1, month };
  });
}

export function previousMonth({ year, month }: YearMonth): YearMonth {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function formatInr(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}
