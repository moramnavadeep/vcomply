import { addDays } from '../domain/dates';
import type { Obligation } from '../domain/types';

/*
 * iCalendar (RFC 5545) export, so deadlines land in Google Calendar / Outlook,
 * the tools a founder already checks, with a reminder three days ahead.
 */

/** Escapes characters that are structural in iCalendar text values. */
export function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** RFC 5545 limits lines to 75 octets; longer lines continue on the next line after a space. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    // Continuation lines start with a space, which counts toward their 75 octets.
    const limit = parts.length === 0 ? 75 : 74;
    if (currentBytes + charBytes > limit) {
      parts.push(current);
      current = '';
      currentBytes = 0;
    }
    current += char;
    currentBytes += charBytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function compactDate(date: string): string {
  return date.replace(/-/g, '');
}

export function buildIcs(obligations: Obligation[], companyName: string, generatedAt: Date = new Date()): string {
  const stamp = `${generatedAt.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Niyam//Compliance Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(`${companyName} compliance`)}`,
  ];

  for (const obligation of obligations) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${obligation.id}@niyam`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compactDate(obligation.dueDate)}`,
      // All-day events end on the following day (DTEND is exclusive).
      `DTEND;VALUE=DATE:${compactDate(addDays(obligation.dueDate, 1))}`,
      `SUMMARY:${escapeIcsText(`${obligation.form} due: ${obligation.periodLabel}`)}`,
      `DESCRIPTION:${escapeIcsText(`${obligation.title}\n${obligation.description}\nIf late: ${obligation.penalty.note}`)}`,
      `CATEGORIES:${escapeIcsText(obligation.category)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText(`${obligation.form} is due in 3 days`)}`,
      'TRIGGER:-P3D',
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
