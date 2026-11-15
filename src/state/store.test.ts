import { describe, expect, it } from 'vitest';
import { generateObligations, summarize } from '../domain/engine';
import type { AppState, Obligation } from '../domain/types';
import {
  EMPTY_STATE,
  STORAGE_KEY,
  backfillCompletions,
  buildSampleState,
  loadState,
  parseState,
  reducer,
  sampleProfile,
  saveState,
} from './store';

const TODAY = '2026-11-15';
const AT = '2026-11-15T10:00:00.000Z';
const profile = sampleProfile(TODAY);
const obligations = generateObligations(profile);

function first(predicate: (o: Obligation) => boolean): Obligation {
  const match = obligations.find(predicate);
  if (!match) throw new Error('No matching obligation in the sample calendar');
  return match;
}

const upcoming = first((o) => o.dueDate > TODAY);

function created(backfill: boolean): AppState {
  return reducer(EMPTY_STATE, { type: 'profile_saved', profile, backfill, today: TODAY, at: AT });
}

describe('reducer: profile', () => {
  it('creates the calendar and logs it', () => {
    const state = created(false);
    expect(state.profile).toEqual(profile);
    expect(state.completions).toEqual({});
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0]).toMatchObject({ type: 'profile_created', at: AT });
  });

  it('backfills only obligations that fell due before today', () => {
    const state = created(true);
    const expected = obligations.filter((o) => o.dueDate < TODAY);
    expect(Object.keys(state.completions).sort()).toEqual(expected.map((o) => o.id).sort());
    expect(Object.values(state.completions).every((c) => c.backfilled)).toBe(true);
    expect(summarize(obligations, state.completions, TODAY).overdue).toBe(0);
  });

  it('keeps real filing records when the profile is edited and backfilled again', () => {
    const past = first((o) => o.dueDate < TODAY);
    let state = created(false);
    state = reducer(state, { type: 'filed', obligation: past, filedOn: '2026-05-01', reference: 'ARN-1', note: '', at: AT });
    state = reducer(state, { type: 'profile_saved', profile: { ...profile, name: 'Renamed' }, backfill: true, today: TODAY, at: AT });

    expect(state.completions[past.id]).toMatchObject({ reference: 'ARN-1', backfilled: false });
    expect(state.activity.at(-1)?.type).toBe('profile_updated');
  });

  it('keeps completions for filings that stop applying, in case the answer is switched back', () => {
    const gstFiling = first((o) => o.category === 'GST');
    let state = created(false);
    state = reducer(state, { type: 'filed', obligation: gstFiling, filedOn: gstFiling.dueDate, reference: '', note: '', at: AT });
    state = reducer(state, { type: 'profile_saved', profile: { ...profile, gstRegistered: false }, backfill: false, today: TODAY, at: AT });
    expect(state.completions[gstFiling.id]).toBeDefined();
  });
});

describe('reducer: filing', () => {
  it('records a filing with trimmed evidence and logs it', () => {
    const state = reducer(created(false), {
      type: 'filed',
      obligation: upcoming,
      filedOn: TODAY,
      reference: '  ARN-42  ',
      note: ' paid by netbanking ',
      at: AT,
    });
    expect(state.completions[upcoming.id]).toEqual({ filedOn: TODAY, reference: 'ARN-42', note: 'paid by netbanking', backfilled: false });
    expect(state.activity.at(-1)).toMatchObject({ type: 'filed', obligationId: upcoming.id });
    expect(state.activity.at(-1)?.message).toContain('ARN-42');
  });

  it('flags a late filing in the log', () => {
    const past = first((o) => o.dueDate < TODAY);
    const state = reducer(created(false), { type: 'filed', obligation: past, filedOn: TODAY, reference: '', note: '', at: AT });
    expect(state.activity.at(-1)?.message).toContain('(late)');
  });

  it('reopens a filing and logs it', () => {
    let state = reducer(created(false), { type: 'filed', obligation: upcoming, filedOn: TODAY, reference: '', note: '', at: AT });
    state = reducer(state, { type: 'reopened', obligation: upcoming, at: AT });
    expect(state.completions[upcoming.id]).toBeUndefined();
    expect(state.activity.map((a) => a.type)).toEqual(['profile_created', 'filed', 'reopened']);
  });

  it('ignores reopening something that was never filed', () => {
    const state = created(false);
    expect(reducer(state, { type: 'reopened', obligation: upcoming, at: AT })).toBe(state);
  });

  it('never mutates the previous state', () => {
    const before = created(false);
    const snapshot = JSON.stringify(before);
    reducer(before, { type: 'filed', obligation: upcoming, filedOn: TODAY, reference: '', note: '', at: AT });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('gives every activity entry a unique id', () => {
    let state = created(false);
    for (let i = 0; i < 3; i += 1) {
      state = reducer(state, { type: 'filed', obligation: upcoming, filedOn: TODAY, reference: '', note: '', at: AT });
      state = reducer(state, { type: 'reopened', obligation: upcoming, at: AT });
    }
    const ids = state.activity.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resets to an empty state', () => {
    expect(reducer(created(true), { type: 'reset' })).toEqual(EMPTY_STATE);
  });
});

describe('backfillCompletions', () => {
  it('does not treat something due today as already filed', () => {
    const dueToday = first((o) => o.dueDate > TODAY);
    const { completions, added } = backfillCompletions([dueToday], {}, dueToday.dueDate);
    expect(added).toBe(0);
    expect(completions).toEqual({});
  });
});

describe('parseState', () => {
  const valid = created(true);

  it('round-trips a saved state', () => {
    expect(parseState(JSON.parse(JSON.stringify(valid)))).toEqual(JSON.parse(JSON.stringify(valid)));
  });

  it.each([
    ['a non-object', 'hello'],
    ['an array', []],
    ['null', null],
    ['a wrong version', { ...valid, version: 2 }],
    ['an incomplete profile', { ...valid, profile: { name: 'x' } }],
    ['an unknown entity type', { ...valid, profile: { ...profile, entityType: 'trust' } }],
    ['a negative turnover', { ...valid, profile: { ...profile, annualTurnoverLakh: -1 } }],
    ['an impossible filing date', { ...valid, completions: { x: { filedOn: '2026-02-31', reference: '', note: '', backfilled: false } } }],
    ['a malformed activity log', { ...valid, activity: [{ id: 1 }] }],
    ['missing completions', { version: 1, profile: null, activity: [] }],
  ])('rejects %s', (_label, data) => {
    expect(() => parseState(data)).toThrow(Error);
  });
});

describe('persistence', () => {
  it('saves and loads through localStorage', () => {
    const state = created(true);
    expect(saveState(state)).toBe(true);
    expect(loadState()).toEqual(JSON.parse(JSON.stringify(state)));
  });

  it('starts clean when nothing is stored', () => {
    expect(loadState()).toEqual(EMPTY_STATE);
  });

  it('starts clean instead of crashing on corrupt storage', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadState()).toEqual(EMPTY_STATE);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99 }));
    expect(loadState()).toEqual(EMPTY_STATE);
  });

  it('reports a failed write instead of throwing', () => {
    const fullStorage = {
      setItem: () => {
        throw new DOMException('QuotaExceededError');
      },
    };
    expect(saveState(created(false), fullStorage)).toBe(false);
  });
});

describe('buildSampleState', () => {
  it.each(['2026-04-01', '2026-04-12', '2026-11-15', '2027-03-31'])('produces a valid state on %s', (today) => {
    const state = buildSampleState(today, AT);
    expect(() => parseState(JSON.parse(JSON.stringify(state)))).not.toThrow();
    expect(state.profile?.complianceYear).toBe(2026);
  });

  it('shows history, one late filing and two missed deadlines mid-year', () => {
    const state = buildSampleState(TODAY, AT);
    const summary = summarize(obligations, state.completions, TODAY);
    expect(summary.overdue).toBe(2);
    expect(Object.values(state.completions).filter((c) => !c.backfilled)).toHaveLength(1);
    expect(summary.filed).toBeGreaterThan(10);
  });
});
