import { addDays, complianceYearOf, formatDate, isValidIsoDate } from '../domain/dates';
import { generateObligations } from '../domain/engine';
import type {
  ActivityEntry,
  ActivityType,
  AppState,
  CompanyProfile,
  Completion,
  IsoDate,
  Obligation,
} from '../domain/types';

export const STORAGE_KEY = 'niyam.state.v1';

export const EMPTY_STATE: AppState = { version: 1, profile: null, completions: {}, activity: [] };

/*
 * Every action carries its own timestamp (`at`) and, where needed, today's date.
 * The reducer never reads the clock, which keeps it pure and trivially testable.
 */
export type Action =
  | { type: 'profile_saved'; profile: CompanyProfile; backfill: boolean; today: IsoDate; at: string }
  | { type: 'filed'; obligation: Obligation; filedOn: IsoDate; reference: string; note: string; at: string }
  | { type: 'reopened'; obligation: Obligation; at: string }
  | { type: 'imported'; state: AppState; at: string }
  | { type: 'sample_loaded'; state: AppState }
  | { type: 'reset' };

function logEntry(state: AppState, at: string, type: ActivityType, message: string, obligationId?: string): ActivityEntry[] {
  const entry: ActivityEntry = { id: `a${state.activity.length + 1}`, at, type, message, obligationId };
  return [...state.activity, entry];
}

function describe(obligation: Obligation): string {
  return `${obligation.form} for ${obligation.periodLabel}`;
}

/**
 * Marks obligations that fell due before tracking started as already filed.
 * Without this a company onboarding mid-year would open to a wall of false "overdue" alarms.
 * Existing records are never overwritten.
 */
export function backfillCompletions(
  obligations: Obligation[],
  completions: Record<string, Completion>,
  today: IsoDate,
): { completions: Record<string, Completion>; added: number } {
  const next = { ...completions };
  let added = 0;
  for (const obligation of obligations) {
    if (obligation.dueDate < today && !next[obligation.id]) {
      next[obligation.id] = {
        filedOn: obligation.dueDate,
        reference: '',
        note: 'Assumed filed before tracking began',
        backfilled: true,
      };
      added += 1;
    }
  }
  return { completions: next, added };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'profile_saved': {
      const isNew = state.profile === null;
      let completions = state.completions;
      let message = isNew ? `Calendar created for ${action.profile.name}` : 'Company profile updated; calendar regenerated';

      if (action.backfill) {
        const result = backfillCompletions(generateObligations(action.profile), completions, action.today);
        completions = result.completions;
        if (result.added > 0) message += ` (${result.added} past filings assumed complete)`;
      }

      return {
        ...state,
        profile: action.profile,
        completions,
        activity: logEntry(state, action.at, isNew ? 'profile_created' : 'profile_updated', message),
      };
    }

    case 'filed': {
      const { obligation, filedOn, at } = action;
      const completion: Completion = {
        filedOn,
        reference: action.reference.trim(),
        note: action.note.trim(),
        backfilled: false,
      };
      const lateness = filedOn > obligation.dueDate ? ' (late)' : '';
      const reference = completion.reference ? `, ref ${completion.reference}` : '';
      const message = `Filed ${describe(obligation)} on ${formatDate(filedOn)}${lateness}${reference}`;
      return {
        ...state,
        completions: { ...state.completions, [obligation.id]: completion },
        activity: logEntry(state, at, 'filed', message, obligation.id),
      };
    }

    case 'reopened': {
      const { [action.obligation.id]: removed, ...rest } = state.completions;
      if (!removed) return state;
      return {
        ...state,
        completions: rest,
        activity: logEntry(state, action.at, 'reopened', `Reopened ${describe(action.obligation)}`, action.obligation.id),
      };
    }

    case 'imported':
      return {
        ...action.state,
        activity: logEntry(action.state, action.at, 'imported', 'Data restored from a backup file'),
      };

    case 'sample_loaded':
      return action.state;

    case 'reset':
      return EMPTY_STATE;
  }
}

// ---------------------------------------------------------------------------
// Validation: shared by localStorage loading and backup import
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProfile(value: unknown): value is CompanyProfile {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === 'string' &&
    (value.entityType === 'private_limited' || value.entityType === 'llp') &&
    Number.isInteger(value.complianceYear) &&
    typeof value.gstRegistered === 'boolean' &&
    (value.gstScheme === 'monthly' || value.gstScheme === 'qrmp') &&
    typeof value.annualTurnoverLakh === 'number' &&
    value.annualTurnoverLakh >= 0 &&
    typeof value.deductsTds === 'boolean' &&
    typeof value.employeeCount === 'number' &&
    value.employeeCount >= 0 &&
    typeof value.pfRegistered === 'boolean' &&
    typeof value.esiRegistered === 'boolean' &&
    typeof value.expectsTaxLiability === 'boolean' &&
    typeof value.hasOutstandingLoans === 'boolean'
  );
}

function isCompletion(value: unknown): value is Completion {
  return (
    isRecord(value) &&
    isValidIsoDate(value.filedOn) &&
    typeof value.reference === 'string' &&
    typeof value.note === 'string' &&
    typeof value.backfilled === 'boolean'
  );
}

function isActivityEntry(value: unknown): value is ActivityEntry {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.at === 'string' &&
    typeof value.type === 'string' &&
    typeof value.message === 'string'
  );
}

/** Validates untrusted data (a backup file or stored JSON). Throws a readable Error when it is not usable. */
export function parseState(data: unknown): AppState {
  if (!isRecord(data)) throw new Error('This file is not a Niyam backup.');
  if (data.version !== 1) throw new Error('This backup was made by an unsupported version of Niyam.');
  if (data.profile !== null && !isProfile(data.profile)) throw new Error('The company profile in this backup is incomplete or invalid.');
  if (!isRecord(data.completions) || !Object.values(data.completions).every(isCompletion)) {
    throw new Error('The filing records in this backup are invalid.');
  }
  if (!Array.isArray(data.activity) || !data.activity.every(isActivityEntry)) {
    throw new Error('The activity log in this backup is invalid.');
  }
  return {
    version: 1,
    profile: data.profile,
    completions: data.completions as Record<string, Completion>,
    activity: data.activity,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Corrupt or missing storage falls back to a clean start instead of crashing the app. */
export function loadState(storage: Pick<Storage, 'getItem'> = localStorage): AppState {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? parseState(JSON.parse(raw)) : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

/** Returns false when the browser refused the write (private mode, quota), so the UI can warn. */
export function saveState(state: AppState, storage: Pick<Storage, 'setItem'> = localStorage): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sample data, so the product can be explored without typing anything
// ---------------------------------------------------------------------------

export function sampleProfile(today: IsoDate): CompanyProfile {
  return {
    name: 'Kaveri Labs Pvt Ltd',
    entityType: 'private_limited',
    complianceYear: complianceYearOf(today),
    gstRegistered: true,
    gstScheme: 'monthly',
    annualTurnoverLakh: 320,
    deductsTds: true,
    employeeCount: 24,
    pfRegistered: true,
    esiRegistered: true,
    expectsTaxLiability: true,
    hasOutstandingLoans: true,
  };
}

/**
 * A realistic mid-year picture: history filed, one filing that went in late,
 * and the two most recent deadlines missed.
 */
export function buildSampleState(today: IsoDate, at: string): AppState {
  const profile = sampleProfile(today);
  const obligations = generateObligations(profile);
  let state = reducer(EMPTY_STATE, { type: 'profile_saved', profile, backfill: false, today, at });

  // The two most recent past deadlines get no completion, so they show up as overdue.
  const past = obligations.filter((o) => o.dueDate < today);
  const filedLate = past.at(-3);
  const filedOnTime = past.slice(0, -3);

  state = { ...state, completions: backfillCompletions(filedOnTime, {}, today).completions };
  if (filedLate) {
    state = reducer(state, {
      type: 'filed',
      obligation: filedLate,
      filedOn: addDays(filedLate.dueDate, 4),
      reference: 'ACK-7731902',
      note: 'Delayed: accountant was on leave',
      at,
    });
  }
  return state;
}
