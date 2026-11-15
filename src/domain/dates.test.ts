import { describe, expect, it } from 'vitest';
import {
  addDays,
  complianceYearOf,
  daysBetween,
  financialYearLabel,
  formatDate,
  formatInr,
  isValidIsoDate,
  isoDate,
  monthsOfComplianceYear,
  previousMonth,
  todayIso,
} from './dates';

describe('isoDate', () => {
  it('formats with zero padding', () => {
    expect(isoDate(2026, 4, 7)).toBe('2026-04-07');
  });

  it('rejects dates that do not exist', () => {
    expect(() => isoDate(2026, 6, 31)).toThrow(RangeError);
    expect(() => isoDate(2027, 2, 29)).toThrow(RangeError);
  });

  it('accepts 29 February in a leap year', () => {
    expect(isoDate(2028, 2, 29)).toBe('2028-02-29');
  });
});

describe('isValidIsoDate', () => {
  it.each(['2026-11-15', '2028-02-29'])('accepts %s', (value) => {
    expect(isValidIsoDate(value)).toBe(true);
  });

  it.each(['2026-13-01', '2026-02-30', '15-11-2026', '2026-1-5', '', null, 20261115])('rejects %s', (value) => {
    expect(isValidIsoDate(value)).toBe(false);
  });
});

describe('date arithmetic', () => {
  it('counts days across month and year boundaries', () => {
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(daysBetween('2026-11-20', '2026-11-15')).toBe(-5);
    expect(daysBetween('2026-11-15', '2026-11-15')).toBe(0);
  });

  it('counts the leap day', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('adds days across a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('compliance year', () => {
  it('starts in April', () => {
    expect(complianceYearOf('2026-03-31')).toBe(2025);
    expect(complianceYearOf('2026-04-01')).toBe(2026);
    expect(complianceYearOf('2027-01-15')).toBe(2026);
  });

  it('lists April to March in order', () => {
    const months = monthsOfComplianceYear(2026);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ year: 2026, month: 4 });
    expect(months[8]).toEqual({ year: 2026, month: 12 });
    expect(months[9]).toEqual({ year: 2027, month: 1 });
    expect(months[11]).toEqual({ year: 2027, month: 3 });
  });

  it('labels financial years, including the century rollover', () => {
    expect(financialYearLabel(2026)).toBe('FY 2026-27');
    expect(financialYearLabel(2099)).toBe('FY 2099-00');
  });

  it('wraps January back to December of the previous year', () => {
    expect(previousMonth({ year: 2027, month: 1 })).toEqual({ year: 2026, month: 12 });
    expect(previousMonth({ year: 2026, month: 4 })).toEqual({ year: 2026, month: 3 });
  });
});

describe('formatting', () => {
  it('formats dates for display', () => {
    expect(formatDate('2026-11-05')).toBe('5 Nov 2026');
  });

  it('formats rupees with Indian digit grouping', () => {
    expect(formatInr(150000)).toBe('₹1,50,000');
    expect(formatInr(0)).toBe('₹0');
  });

  it('reads today from local time, not UTC', () => {
    expect(todayIso(new Date(2026, 10, 5, 23, 59))).toBe('2026-11-05');
    expect(todayIso(new Date(2026, 0, 1, 0, 1))).toBe('2026-01-01');
  });
});
