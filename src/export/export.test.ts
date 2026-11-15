import { describe, expect, it } from 'vitest';
import { generateObligations } from '../domain/engine';
import { sampleProfile } from '../state/store';
import { buildRegisterCsv, csvCell } from './csv';
import { slugify } from './download';
import { buildIcs, escapeIcsText, foldLine } from './ics';

const TODAY = '2026-11-15';
const obligations = generateObligations(sampleProfile(TODAY));
const STAMP = new Date('2026-11-15T10:00:00Z');

describe('iCalendar export', () => {
  const ics = buildIcs(obligations, 'Kaveri Labs, Pvt; Ltd', STAMP);
  const lines = ics.split('\r\n');

  it('wraps one event per obligation in a calendar', () => {
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines.at(-2)).toBe('END:VCALENDAR');
    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(obligations.length);
    expect(lines.filter((line) => line === 'END:VEVENT')).toHaveLength(obligations.length);
  });

  it('uses CRLF line endings throughout', () => {
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('keeps every line within 75 octets', () => {
    const encoder = new TextEncoder();
    for (const line of lines) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
  });

  it('writes all-day events that end the following day', () => {
    const single = buildIcs(obligations.filter((o) => o.id === 'gstr3b-monthly:2026-12'), 'X', STAMP);
    expect(single).toContain('DTSTART;VALUE=DATE:20270120');
    expect(single).toContain('DTEND;VALUE=DATE:20270121');
    expect(single).toContain('DTSTAMP:20261115T100000Z');
    expect(single).toContain('TRIGGER:-P3D');
  });

  it('gives events stable, unique UIDs so re-importing updates rather than duplicates', () => {
    const uids = lines.filter((line) => line.startsWith('UID:'));
    expect(new Set(uids).size).toBe(obligations.length);
    expect(buildIcs(obligations, 'X', new Date('2027-01-01T00:00:00Z')).split('\r\n').filter((l) => l.startsWith('UID:'))).toEqual(uids);
  });

  it('escapes structural characters in text', () => {
    expect(escapeIcsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    expect(ics).toContain('X-WR-CALNAME:Kaveri Labs\\, Pvt\\; Ltd compliance');
  });

  it('produces a valid empty calendar when there is nothing to export', () => {
    const empty = buildIcs([], 'X', STAMP);
    expect(empty).toContain('BEGIN:VCALENDAR');
    expect(empty).not.toContain('BEGIN:VEVENT');
  });
});

describe('foldLine', () => {
  it('leaves short lines alone', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('folds long lines with a leading space and loses nothing', () => {
    const long = `DESCRIPTION:${'x'.repeat(200)}`;
    const folded = foldLine(long);
    expect(folded.split('\r\n').length).toBeGreaterThan(1);
    expect(folded.replace(/\r\n /g, '')).toBe(long);
  });

  it('never splits a multi-byte character such as the rupee sign', () => {
    const long = '₹'.repeat(60);
    const folded = foldLine(long);
    expect(folded.replace(/\r\n /g, '')).toBe(long);
    for (const part of folded.split('\r\n')) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
  });
});

describe('CSV export', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralises spreadsheet formulas typed into free-text fields', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@cmd')).toBe("'@cmd");
  });

  it('leaves real numbers untouched', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(1300)).toBe('1300');
  });

  it('writes a header plus one row per obligation, with filing evidence', () => {
    const target = obligations.find((o) => o.id === 'gstr3b-monthly:2026-09');
    if (!target) throw new Error('fixture missing');
    const csv = buildRegisterCsv(obligations, { [target.id]: { filedOn: '2026-10-25', reference: 'ARN-9', note: 'late, sorry', backfilled: false } }, TODAY);
    const rows = csv.trimEnd().split('\r\n');
    expect(rows).toHaveLength(obligations.length + 1);
    expect(rows[0]).toContain('Due date,Category,Form');
    const row = rows.find((r) => r.startsWith('2026-10-20,GST,GSTR-3B'));
    expect(row).toContain('Filed late,2026-10-25,5,ARN-9,"late, sorry",250');
  });

  it('says so when a late fee cannot be computed', () => {
    const tds = obligations.filter((o) => o.id === 'tds-deposit:2026-10');
    expect(buildRegisterCsv(tds, {}, TODAY)).toContain('Overdue,,8,,,Depends on amount due');
  });
});

describe('slugify', () => {
  it('makes a safe file name', () => {
    expect(slugify('Kaveri Labs Pvt. Ltd')).toBe('kaveri-labs-pvt-ltd');
    expect(slugify('  ***  ')).toBe('company');
  });
});
