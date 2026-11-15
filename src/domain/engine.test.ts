import { describe, expect, it } from 'vitest';
import { isValidIsoDate } from './dates';
import { estimatePenalty, daysLate, generateObligations, getStatus, summarize } from './engine';
import { RULES } from './rules';
import type { CompanyProfile, Completion, Obligation } from './types';

const baseProfile: CompanyProfile = {
  name: 'Test Co',
  entityType: 'private_limited',
  complianceYear: 2026,
  gstRegistered: false,
  gstScheme: 'monthly',
  annualTurnoverLakh: 50,
  deductsTds: false,
  employeeCount: 0,
  pfRegistered: false,
  esiRegistered: false,
  expectsTaxLiability: false,
  hasOutstandingLoans: false,
};

const profile = (overrides: Partial<CompanyProfile> = {}): CompanyProfile => ({ ...baseProfile, ...overrides });

function dueDates(obligations: Obligation[], ruleId: string): string[] {
  return obligations.filter((o) => o.ruleId === ruleId).map((o) => o.dueDate);
}

function find(obligations: Obligation[], id: string): Obligation {
  const match = obligations.find((o) => o.id === id);
  if (!match) throw new Error(`Obligation ${id} was not generated`);
  return match;
}

const filed = (filedOn: string): Completion => ({ filedOn, reference: '', note: '', backfilled: false });

describe('rule catalogue', () => {
  it('has unique rule ids', () => {
    const ids = RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each([2024, 2026, 2027, 2031])('every rule schedules valid, in-window, unique dates for %i', (year) => {
    for (const rule of RULES) {
      const occurrences = rule.schedule(year);
      expect(occurrences.length).toBeGreaterThan(0);
      expect(new Set(occurrences.map((o) => o.periodKey)).size).toBe(occurrences.length);
      for (const occurrence of occurrences) {
        expect(isValidIsoDate(occurrence.dueDate)).toBe(true);
        expect(occurrence.dueDate >= `${year}-04-01`).toBe(true);
        expect(occurrence.dueDate <= `${year + 1}-03-31`).toBe(true);
      }
    }
  });
});

describe('generateObligations: applicability', () => {
  it('gives the smallest private company only its unavoidable filings', () => {
    const ruleIds = new Set(generateObligations(profile()).map((o) => o.ruleId));
    expect(ruleIds).toEqual(new Set(['itr-audited', 'agm', 'aoc4', 'mgt7']));
  });

  it('gives an LLP the LLP forms and never the company forms', () => {
    const ruleIds = new Set(generateObligations(profile({ entityType: 'llp', annualTurnoverLakh: 30, hasOutstandingLoans: true })).map((o) => o.ruleId));
    expect(ruleIds).toEqual(new Set(['itr-unaudited', 'llp-form11', 'llp-form8']));
  });

  it('moves the LLP return from 31 July to 31 October once an audit is needed', () => {
    const small = generateObligations(profile({ entityType: 'llp', annualTurnoverLakh: 40 }));
    const large = generateObligations(profile({ entityType: 'llp', annualTurnoverLakh: 40.01 }));
    expect(dueDates(small, 'itr-unaudited')).toEqual(['2026-07-31']);
    expect(dueDates(large, 'itr-audited')).toEqual(['2026-10-31']);
    expect(dueDates(large, 'itr-unaudited')).toEqual([]);
  });

  it('switches GST filings between the monthly and quarterly schemes', () => {
    const monthly = generateObligations(profile({ gstRegistered: true, gstScheme: 'monthly' }));
    const quarterly = generateObligations(profile({ gstRegistered: true, gstScheme: 'qrmp' }));
    expect(dueDates(monthly, 'gstr3b-monthly')).toHaveLength(12);
    expect(dueDates(monthly, 'pmt06')).toHaveLength(0);
    expect(dueDates(quarterly, 'gstr3b-monthly')).toHaveLength(0);
    expect(dueDates(quarterly, 'gstr1-quarterly')).toEqual(['2026-04-13', '2026-07-13', '2026-10-13', '2027-01-13']);
    expect(dueDates(quarterly, 'gstr3b-quarterly')).toEqual(['2026-04-22', '2026-07-22', '2026-10-22', '2027-01-22']);
  });

  it('ignores the GST scheme when the company is not GST-registered', () => {
    const obligations = generateObligations(profile({ gstRegistered: false, gstScheme: 'qrmp', annualTurnoverLakh: 900 }));
    expect(obligations.filter((o) => o.category === 'GST')).toEqual([]);
  });

  it('applies turnover thresholds strictly above the limit', () => {
    const at = (lakh: number) => new Set(generateObligations(profile({ gstRegistered: true, annualTurnoverLakh: lakh })).map((o) => o.ruleId));
    expect(at(200).has('gstr9')).toBe(false);
    expect(at(201).has('gstr9')).toBe(true);
    expect(at(500).has('gstr9c')).toBe(false);
    expect(at(501).has('gstr9c')).toBe(true);
    expect(at(1000).has('tax-audit')).toBe(false);
    expect(at(1001).has('tax-audit')).toBe(true);
  });

  it('only asks for Form 16 when there are employees', () => {
    const withoutStaff = generateObligations(profile({ deductsTds: true, employeeCount: 0 }));
    const withStaff = generateObligations(profile({ deductsTds: true, employeeCount: 3 }));
    expect(dueDates(withoutStaff, 'form16')).toEqual([]);
    expect(dueDates(withStaff, 'form16')).toEqual(['2026-06-15']);
  });

  it('explains why each obligation applies', () => {
    const obligations = generateObligations(profile({ gstRegistered: true, annualTurnoverLakh: 320 }));
    expect(find(obligations, 'gstr9:FY2025').reason).toContain('₹3.2 crore');
    expect(obligations.every((o) => o.reason.length > 0)).toBe(true);
  });
});

describe('generateObligations: schedules', () => {
  it('schedules monthly GST returns in the month after the period', () => {
    const obligations = generateObligations(profile({ gstRegistered: true }));
    const first = find(obligations, 'gstr3b-monthly:2026-03');
    const last = find(obligations, 'gstr3b-monthly:2027-02');
    expect(first).toMatchObject({ dueDate: '2026-04-20', periodLabel: 'March 2026' });
    expect(last).toMatchObject({ dueDate: '2027-03-20', periodLabel: 'February 2027' });
    expect(find(obligations, 'gstr1-monthly:2026-12').dueDate).toBe('2027-01-11');
  });

  it('gives March TDS until 30 April and every other month until the 7th', () => {
    const obligations = generateObligations(profile({ deductsTds: true }));
    expect(find(obligations, 'tds-deposit:2026-03').dueDate).toBe('2026-04-30');
    expect(find(obligations, 'tds-deposit:2026-04').dueDate).toBe('2026-05-07');
    expect(find(obligations, 'tds-deposit:2026-12').dueDate).toBe('2027-01-07');
  });

  it('gives the year-end TDS return until 31 May', () => {
    const obligations = generateObligations(profile({ deductsTds: true }));
    expect(dueDates(obligations, 'tds-return')).toEqual(['2026-05-31', '2026-07-31', '2026-10-31', '2027-01-31']);
    expect(find(obligations, 'tds-return:2025-Q4').periodLabel).toBe('Jan–Mar 2026');
  });

  it('skips PMT-06 for the last month of each quarter', () => {
    const obligations = generateObligations(profile({ gstRegistered: true, gstScheme: 'qrmp' }));
    const periods = obligations.filter((o) => o.ruleId === 'pmt06').map((o) => o.periodLabel.split(' ')[0]);
    expect(periods).toEqual(['April', 'May', 'July', 'August', 'October', 'November', 'January', 'February']);
  });

  it('schedules four advance-tax instalments for the current financial year', () => {
    const obligations = generateObligations(profile({ expectsTaxLiability: true }));
    expect(dueDates(obligations, 'advance-tax')).toEqual(['2026-06-15', '2026-09-15', '2026-12-15', '2027-03-15']);
  });

  it('orders the company year-end chain: AGM, then AOC-4, then MGT-7', () => {
    const obligations = generateObligations(profile());
    expect(find(obligations, 'agm:FY2025').dueDate).toBe('2026-09-30');
    expect(find(obligations, 'aoc4:FY2025').dueDate).toBe('2026-10-30');
    expect(find(obligations, 'mgt7:FY2025').dueDate).toBe('2026-11-29');
  });

  it('returns obligations sorted by due date with unique ids', () => {
    const obligations = generateObligations(
      profile({ gstRegistered: true, deductsTds: true, employeeCount: 30, pfRegistered: true, esiRegistered: true, expectsTaxLiability: true, hasOutstandingLoans: true, annualTurnoverLakh: 1200 }),
    );
    const dates = obligations.map((o) => o.dueDate);
    expect(dates).toEqual([...dates].sort());
    expect(new Set(obligations.map((o) => o.id)).size).toBe(obligations.length);
  });

  it('keeps obligation ids stable when unrelated profile answers change', () => {
    const before = generateObligations(profile({ gstRegistered: true })).map((o) => o.id);
    const after = generateObligations(profile({ gstRegistered: true, deductsTds: true, name: 'Renamed' })).map((o) => o.id);
    expect(after).toEqual(expect.arrayContaining(before));
  });
});

describe('getStatus', () => {
  const obligation = find(generateObligations(profile({ gstRegistered: true })), 'gstr3b-monthly:2026-10'); // due 2026-11-20

  it.each([
    ['2026-11-12', 'upcoming'],
    ['2026-11-13', 'due_soon'],
    ['2026-11-20', 'due_soon'],
    ['2026-11-21', 'overdue'],
  ])('on %s an open obligation is %s', (today, expected) => {
    expect(getStatus(obligation, undefined, today)).toBe(expected);
  });

  it('treats filing on the due date as on time and the day after as late', () => {
    expect(getStatus(obligation, filed('2026-11-20'), '2026-12-01')).toBe('filed');
    expect(getStatus(obligation, filed('2026-11-21'), '2026-12-01')).toBe('filed_late');
  });
});

describe('daysLate and estimatePenalty', () => {
  const obligation = find(generateObligations(profile({ gstRegistered: true })), 'gstr3b-monthly:2026-10');

  it('is zero until the due date has passed', () => {
    expect(daysLate(obligation, undefined, '2026-11-01')).toBe(0);
    expect(daysLate(obligation, undefined, '2026-11-20')).toBe(0);
    expect(daysLate(obligation, undefined, '2026-11-25')).toBe(5);
  });

  it('stops counting at the filing date', () => {
    expect(daysLate(obligation, filed('2026-11-23'), '2027-01-01')).toBe(3);
    expect(daysLate(obligation, filed('2026-11-10'), '2027-01-01')).toBe(0);
  });

  it('charges per day up to the cap', () => {
    const penalty = { kind: 'per_day', amountPerDay: 50, cap: 10_000, note: '' } as const;
    expect(estimatePenalty(penalty, 0)).toBe(0);
    expect(estimatePenalty(penalty, 5)).toBe(250);
    expect(estimatePenalty(penalty, 200)).toBe(10_000);
    expect(estimatePenalty(penalty, 5000)).toBe(10_000);
  });

  it('charges per day without limit when there is no cap', () => {
    expect(estimatePenalty({ kind: 'per_day', amountPerDay: 100, note: '' }, 400)).toBe(40_000);
  });

  it('charges a flat fee once, however late', () => {
    const penalty = { kind: 'flat', amount: 5000, note: '' } as const;
    expect(estimatePenalty(penalty, 1)).toBe(5000);
    expect(estimatePenalty(penalty, 300)).toBe(5000);
    expect(estimatePenalty(penalty, 0)).toBe(0);
  });

  it('refuses to guess a penalty that depends on the unpaid amount', () => {
    expect(estimatePenalty({ kind: 'variable', note: '' }, 10)).toBeNull();
    expect(estimatePenalty({ kind: 'variable', note: '' }, 0)).toBe(0);
  });
});

describe('summarize', () => {
  const obligations = generateObligations(profile({ gstRegistered: true, deductsTds: true }));
  const today = '2026-11-15';

  it('reports no on-time rate before anything has fallen due', () => {
    const summary = summarize(obligations, {}, '2026-04-01');
    expect(summary.onTimeRate).toBeNull();
    expect(summary.overdue).toBe(0);
    expect(summary.exposure).toBe(0);
  });

  it('counts every status exactly once', () => {
    const summary = summarize(obligations, {}, today);
    expect(summary.filed + summary.overdue + summary.dueSoon + summary.upcoming).toBe(summary.total);
    expect(summary.onTimeRate).toBe(0);
  });

  it('adds up accrued late fees and the daily burn, leaving out unquantifiable items', () => {
    const gstr3b = find(obligations, 'gstr3b-monthly:2026-09'); // due 20 Oct, 26 days late
    const tdsDeposit = find(obligations, 'tds-deposit:2026-10'); // due 7 Nov, interest-based
    const completions: Record<string, Completion> = {};
    for (const o of obligations) {
      if (o.dueDate < today && o.id !== gstr3b.id && o.id !== tdsDeposit.id) completions[o.id] = filed(o.dueDate);
    }
    const summary = summarize(obligations, completions, today);
    expect(summary.overdue).toBe(2);
    expect(summary.exposure).toBe(26 * 50);
    expect(summary.exposurePerDay).toBe(50);
    expect(summary.unquantifiedOverdue).toBe(1);
  });

  it('stops the daily burn once a fee has reached its cap', () => {
    const summary = summarize(obligations.filter((o) => o.id === 'gstr3b-monthly:2026-03'), {}, '2027-03-31');
    expect(summary.exposure).toBe(10_000);
    expect(summary.exposurePerDay).toBe(0);
  });

  it('counts late filings against the on-time rate', () => {
    const past = obligations.filter((o) => o.dueDate < today);
    const completions: Record<string, Completion> = {};
    past.forEach((o, index) => {
      completions[o.id] = filed(index === 0 ? '2026-11-01' : o.dueDate);
    });
    const summary = summarize(obligations, completions, today);
    expect(summary.overdue).toBe(0);
    expect(summary.onTimeRate).toBe(Math.round(((past.length - 1) / past.length) * 100));
  });
});
