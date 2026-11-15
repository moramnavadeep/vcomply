import {
  financialYearLabel,
  isoDate,
  monthName,
  monthsOfComplianceYear,
  previousMonth,
  type YearMonth,
} from './dates';
import type { CompanyProfile, Occurrence, Rule } from './types';

/*
 * The rule catalogue: every statutory obligation Niyam knows about.
 *
 * Each rule is plain data plus two small pure functions:
 *   applies(profile)  -> why the rule applies to this company, or null
 *   schedule(year)    -> the dated occurrences inside the April–March window
 *
 * Adding a filing means adding one entry here; nothing else in the app changes.
 * Thresholds live in THRESHOLDS so the numbers the law may revise sit in one place.
 */

export const RULESET_VERSION = '2026.11';

export const THRESHOLDS = {
  /** GSTR-9 annual return is mandatory above ₹2 crore turnover. */
  gstAnnualReturnLakh: 200,
  /** GSTR-9C reconciliation statement is mandatory above ₹5 crore turnover. */
  gstReconciliationLakh: 500,
  /** Income-tax audit limit for businesses with at least 95% digital receipts (₹10 crore). */
  taxAuditLakh: 1000,
  /** An LLP's accounts must be audited above ₹40 lakh turnover. */
  llpAuditLakh: 40,
  /** EPF registration is mandatory from 20 employees, ESI from 10. */
  pfEmployees: 20,
  esiEmployees: 10,
} as const;

// ---------------------------------------------------------------------------
// Schedule helpers
// ---------------------------------------------------------------------------

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * A filing due every month for the previous month's activity.
 * `dayFor` lets a rule vary the day for a specific period (TDS for March is due 30 April).
 */
function monthlyInArrears(year: number, dayFor: (period: YearMonth) => number): Occurrence[] {
  return monthsOfComplianceYear(year).map((dueMonth) => {
    const period = previousMonth(dueMonth);
    return {
      periodKey: `${period.year}-${pad(period.month)}`,
      periodLabel: `${monthName(period.month)} ${period.year}`,
      dueDate: isoDate(dueMonth.year, dueMonth.month, dayFor(period)),
    };
  });
}

interface Quarter {
  key: string;
  label: string;
  /** The month immediately after the quarter ends. */
  following: YearMonth;
  isLastOfFinancialYear: boolean;
}

/** The four quarters whose filings fall due inside the window starting April `year`. */
function quartersDueIn(year: number): Quarter[] {
  return [
    { key: `${year - 1}-Q4`, label: `Jan–Mar ${year}`, following: { year, month: 4 }, isLastOfFinancialYear: true },
    { key: `${year}-Q1`, label: `Apr–Jun ${year}`, following: { year, month: 7 }, isLastOfFinancialYear: false },
    { key: `${year}-Q2`, label: `Jul–Sep ${year}`, following: { year, month: 10 }, isLastOfFinancialYear: false },
    { key: `${year}-Q3`, label: `Oct–Dec ${year}`, following: { year: year + 1, month: 1 }, isLastOfFinancialYear: false },
  ];
}

function quarterlyOnDay(year: number, day: number): Occurrence[] {
  return quartersDueIn(year).map((quarter) => ({
    periodKey: quarter.key,
    periodLabel: quarter.label,
    dueDate: isoDate(quarter.following.year, quarter.following.month, day),
  }));
}

/** A once-a-year filing, due in `year`, that reports on the financial year just ended. */
function annualForPreviousYear(year: number, month: number, day: number): Occurrence[] {
  return [
    {
      periodKey: `FY${year - 1}`,
      periodLabel: financialYearLabel(year - 1),
      dueDate: isoDate(year, month, day),
    },
  ];
}

// ---------------------------------------------------------------------------
// Applicability helpers
// ---------------------------------------------------------------------------

const isCompany = (profile: CompanyProfile) => profile.entityType === 'private_limited';
const isLlp = (profile: CompanyProfile) => profile.entityType === 'llp';
const llpNeedsAudit = (profile: CompanyProfile) => profile.annualTurnoverLakh > THRESHOLDS.llpAuditLakh;

function turnoverText(lakh: number): string {
  return lakh >= 100 ? `₹${+(lakh / 100).toFixed(2)} crore` : `₹${lakh} lakh`;
}

const GST_LATE_FEE = {
  kind: 'per_day',
  amountPerDay: 50,
  cap: 10_000,
  note: '₹50 per day (₹20 for a nil return), capped between ₹2,000 and ₹10,000 depending on turnover, plus 18% p.a. interest on unpaid tax.',
} as const;

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export const RULES: Rule[] = [
  // ----- GST ---------------------------------------------------------------
  {
    id: 'gstr1-monthly',
    title: 'GSTR-1: outward supplies',
    form: 'GSTR-1',
    category: 'GST',
    authority: 'GST Portal',
    description: 'Invoice-wise details of every sale made in the month. Your customers cannot claim input credit until this is filed.',
    penalty: GST_LATE_FEE,
    applies: (p) => (p.gstRegistered && p.gstScheme === 'monthly' ? 'You are GST-registered and file monthly returns.' : null),
    schedule: (year) => monthlyInArrears(year, () => 11),
  },
  {
    id: 'gstr3b-monthly',
    title: 'GSTR-3B: summary return and tax payment',
    form: 'GSTR-3B',
    category: 'GST',
    authority: 'GST Portal',
    description: 'Monthly summary of sales, input credit and net GST payable. The tax is paid along with this return.',
    penalty: GST_LATE_FEE,
    applies: (p) => (p.gstRegistered && p.gstScheme === 'monthly' ? 'You are GST-registered and file monthly returns.' : null),
    schedule: (year) => monthlyInArrears(year, () => 20),
  },
  {
    id: 'gstr1-quarterly',
    title: 'GSTR-1: outward supplies (quarterly)',
    form: 'GSTR-1',
    category: 'GST',
    authority: 'GST Portal',
    description: 'Invoice-wise details of every sale made in the quarter, filed under the QRMP scheme.',
    penalty: GST_LATE_FEE,
    applies: (p) => (p.gstRegistered && p.gstScheme === 'qrmp' ? 'You are GST-registered under the quarterly (QRMP) scheme.' : null),
    schedule: (year) => quarterlyOnDay(year, 13),
  },
  {
    id: 'gstr3b-quarterly',
    title: 'GSTR-3B: summary return (quarterly)',
    form: 'GSTR-3B',
    category: 'GST',
    authority: 'GST Portal',
    description: 'Quarterly summary return under QRMP. Due on the 22nd in most southern and western states and the 24th elsewhere; Niyam uses the earlier date.',
    penalty: GST_LATE_FEE,
    applies: (p) => (p.gstRegistered && p.gstScheme === 'qrmp' ? 'You are GST-registered under the quarterly (QRMP) scheme.' : null),
    schedule: (year) => quarterlyOnDay(year, 22),
  },
  {
    id: 'pmt06',
    title: 'PMT-06: monthly GST payment',
    form: 'PMT-06',
    category: 'GST',
    authority: 'GST Portal',
    description: 'Under QRMP the return is quarterly but tax is still paid monthly for the first two months of each quarter.',
    penalty: { kind: 'variable', note: '18% p.a. interest on the tax paid late.' },
    applies: (p) => (p.gstRegistered && p.gstScheme === 'qrmp' ? 'QRMP filers still pay tax every month.' : null),
    // The third month of each quarter is settled through GSTR-3B instead.
    schedule: (year) => monthlyInArrears(year, () => 25).filter((o) => Number(o.periodKey.slice(5)) % 3 !== 0),
  },
  {
    id: 'gstr9',
    title: 'GSTR-9: annual GST return',
    form: 'GSTR-9',
    category: 'GST',
    authority: 'GST Portal',
    description: 'Consolidates the whole year of GST returns. Mistakes in monthly returns are usually caught and corrected here.',
    penalty: { kind: 'per_day', amountPerDay: 200, note: 'Up to ₹200 per day (lower slabs apply below ₹20 crore turnover), capped at a percentage of turnover.' },
    applies: (p) =>
      p.gstRegistered && p.annualTurnoverLakh > THRESHOLDS.gstAnnualReturnLakh
        ? `Your turnover (${turnoverText(p.annualTurnoverLakh)}) is above the ₹2 crore limit.`
        : null,
    schedule: (year) => annualForPreviousYear(year, 12, 31),
  },
  {
    id: 'gstr9c',
    title: 'GSTR-9C: reconciliation statement',
    form: 'GSTR-9C',
    category: 'GST',
    authority: 'GST Portal',
    description: 'Self-certified reconciliation between the annual GST return and the audited financial statements.',
    penalty: { kind: 'variable', note: 'Late fee applies together with GSTR-9.' },
    applies: (p) =>
      p.gstRegistered && p.annualTurnoverLakh > THRESHOLDS.gstReconciliationLakh
        ? `Your turnover (${turnoverText(p.annualTurnoverLakh)}) is above the ₹5 crore limit.`
        : null,
    schedule: (year) => annualForPreviousYear(year, 12, 31),
  },

  // ----- TDS ---------------------------------------------------------------
  {
    id: 'tds-deposit',
    title: 'Deposit TDS deducted',
    form: 'Challan ITNS 281',
    category: 'TDS',
    authority: 'Income Tax Department',
    description: 'Tax you deducted from salaries, rent, contractor and professional payments must be deposited with the government.',
    penalty: { kind: 'variable', note: '1.5% interest per month on the amount deposited late; the expense may also be disallowed.' },
    applies: (p) => (p.deductsTds ? 'You deduct TDS on salaries or vendor payments.' : null),
    // Deductions made in March get until 30 April; every other month is due on the 7th.
    schedule: (year) => monthlyInArrears(year, (period) => (period.month === 3 ? 30 : 7)),
  },
  {
    id: 'tds-return',
    title: 'Quarterly TDS return',
    form: 'Form 24Q / 26Q',
    category: 'TDS',
    authority: 'Income Tax Department (TRACES)',
    description: 'Statement of all TDS deducted in the quarter. Employees and vendors only see their tax credit after this is filed.',
    penalty: { kind: 'per_day', amountPerDay: 200, note: '₹200 per day, capped at the TDS amount for the quarter.' },
    applies: (p) => (p.deductsTds ? 'You deduct TDS on salaries or vendor payments.' : null),
    schedule: (year) =>
      quartersDueIn(year).map((quarter) => ({
        periodKey: quarter.key,
        periodLabel: quarter.label,
        // The year-end quarter gets an extra month: 31 May instead of 30 April.
        dueDate: quarter.isLastOfFinancialYear ? isoDate(year, 5, 31) : isoDate(quarter.following.year, quarter.following.month, 31),
      })),
  },
  {
    id: 'form16',
    title: 'Issue Form 16 to employees',
    form: 'Form 16',
    category: 'TDS',
    authority: 'Income Tax Department (TRACES)',
    description: 'Annual salary TDS certificate. Employees need it to file their own income-tax returns.',
    penalty: { kind: 'variable', note: 'A per-day penalty applies for each certificate issued late.' },
    applies: (p) => (p.deductsTds && p.employeeCount > 0 ? `You deduct TDS and have ${p.employeeCount} employee(s).` : null),
    schedule: (year) => annualForPreviousYear(year, 6, 15),
  },

  // ----- Payroll -----------------------------------------------------------
  {
    id: 'pf',
    title: 'EPF contribution and ECR',
    form: 'ECR',
    category: 'Payroll',
    authority: 'EPFO',
    description: 'Deposit the employer and employee provident-fund contributions and file the electronic challan-cum-return.',
    penalty: { kind: 'variable', note: '12% p.a. interest plus damages of 1% per month on the arrears.' },
    applies: (p) => (p.pfRegistered ? `You are registered under EPF (mandatory from ${THRESHOLDS.pfEmployees} employees).` : null),
    schedule: (year) => monthlyInArrears(year, () => 15),
  },
  {
    id: 'esi',
    title: 'ESI contribution',
    form: 'ESI challan',
    category: 'Payroll',
    authority: 'ESIC',
    description: 'Deposit employee state insurance contributions for staff within the ESI wage ceiling.',
    penalty: { kind: 'variable', note: '12% p.a. interest on the delay, plus damages.' },
    applies: (p) => (p.esiRegistered ? `You are registered under ESI (mandatory from ${THRESHOLDS.esiEmployees} employees).` : null),
    schedule: (year) => monthlyInArrears(year, () => 15),
  },

  // ----- Income tax --------------------------------------------------------
  {
    id: 'advance-tax',
    title: 'Advance tax instalment',
    form: 'Challan ITNS 280',
    category: 'Income Tax',
    authority: 'Income Tax Department',
    description: 'Income tax is paid during the year in four instalments rather than in one go at the end.',
    penalty: { kind: 'variable', note: '1% interest per month on the shortfall in each instalment.' },
    applies: (p) => (p.expectsTaxLiability ? 'You expect to owe income tax this year (liability of ₹10,000 or more).' : null),
    schedule: (year) =>
      [
        { quarter: 1, share: '15%', date: isoDate(year, 6, 15) },
        { quarter: 2, share: '45%', date: isoDate(year, 9, 15) },
        { quarter: 3, share: '75%', date: isoDate(year, 12, 15) },
        { quarter: 4, share: '100%', date: isoDate(year + 1, 3, 15) },
      ].map(({ quarter, share, date }) => ({
        periodKey: `FY${year}-I${quarter}`,
        periodLabel: `${financialYearLabel(year)}, instalment ${quarter} (${share} cumulative)`,
        dueDate: date,
      })),
  },
  {
    id: 'tax-audit',
    title: 'Tax audit report',
    form: 'Form 3CA / 3CD',
    category: 'Income Tax',
    authority: 'Income Tax Department',
    description: 'A chartered accountant audits the books for income-tax purposes and uploads the report.',
    penalty: { kind: 'flat', amount: 150_000, note: '0.5% of turnover, up to a maximum of ₹1,50,000.' },
    applies: (p) =>
      p.annualTurnoverLakh > THRESHOLDS.taxAuditLakh
        ? `Your turnover (${turnoverText(p.annualTurnoverLakh)}) is above the ₹10 crore limit for digital-first businesses.`
        : null,
    schedule: (year) => annualForPreviousYear(year, 9, 30),
  },
  {
    id: 'itr-audited',
    title: 'Income-tax return',
    form: 'ITR-6 / ITR-5',
    category: 'Income Tax',
    authority: 'Income Tax Department',
    description: 'Annual income-tax return. Filing late also blocks carrying losses forward to future years.',
    penalty: { kind: 'flat', amount: 5_000, note: '₹5,000 late fee (₹1,000 if total income is under ₹5 lakh), plus 1% monthly interest on unpaid tax.' },
    applies: (p) => {
      if (isCompany(p)) return 'Every company must file a return, and its accounts are always audited.';
      if (llpNeedsAudit(p)) return `LLPs above ₹${THRESHOLDS.llpAuditLakh} lakh turnover are audited, which moves the due date to 31 October.`;
      return null;
    },
    schedule: (year) => annualForPreviousYear(year, 10, 31),
  },
  {
    id: 'itr-unaudited',
    title: 'Income-tax return',
    form: 'ITR-5',
    category: 'Income Tax',
    authority: 'Income Tax Department',
    description: 'Annual income-tax return. Filing late also blocks carrying losses forward to future years.',
    penalty: { kind: 'flat', amount: 5_000, note: '₹5,000 late fee (₹1,000 if total income is under ₹5 lakh), plus 1% monthly interest on unpaid tax.' },
    applies: (p) => (isLlp(p) && !llpNeedsAudit(p) ? 'LLPs that do not need an audit file by 31 July.' : null),
    schedule: (year) => annualForPreviousYear(year, 7, 31),
  },

  // ----- MCA: companies ----------------------------------------------------
  {
    id: 'dpt3',
    title: 'DPT-3: return of loans and deposits',
    form: 'DPT-3',
    category: 'MCA',
    authority: 'Ministry of Corporate Affairs',
    description: 'Reports loans and other money received that is outstanding at year end, including loans from directors.',
    penalty: { kind: 'variable', note: 'Additional filing fee that grows with the delay, up to 12 times the normal fee.' },
    applies: (p) => (isCompany(p) && p.hasOutstandingLoans ? 'Your company has loans or advances outstanding.' : null),
    schedule: (year) => annualForPreviousYear(year, 6, 30),
  },
  {
    id: 'agm',
    title: 'Hold the Annual General Meeting',
    form: 'AGM',
    category: 'MCA',
    authority: 'Ministry of Corporate Affairs',
    description: 'Shareholders adopt the audited financial statements. The AGM date starts the clock for AOC-4 and MGT-7.',
    penalty: { kind: 'variable', note: 'The company and every officer in default can be fined up to ₹1 lakh, plus ₹5,000 per day of continuing default.' },
    applies: (p) => (isCompany(p) ? 'Every private limited company must hold an AGM within six months of year end.' : null),
    schedule: (year) => annualForPreviousYear(year, 9, 30),
  },
  {
    id: 'aoc4',
    title: 'AOC-4: file financial statements',
    form: 'AOC-4',
    category: 'MCA',
    authority: 'Ministry of Corporate Affairs',
    description: 'Audited financial statements filed with the Registrar within 30 days of the AGM. Date assumes the AGM is held on 30 September.',
    penalty: { kind: 'per_day', amountPerDay: 100, note: '₹100 per day with no upper limit.' },
    applies: (p) => (isCompany(p) ? 'Every private limited company files its financial statements with the Registrar.' : null),
    schedule: (year) => annualForPreviousYear(year, 10, 30),
  },
  {
    id: 'mgt7',
    title: 'MGT-7 / 7A: annual return',
    form: 'MGT-7 / MGT-7A',
    category: 'MCA',
    authority: 'Ministry of Corporate Affairs',
    description: 'Snapshot of shareholders, directors and share capital, filed within 60 days of the AGM. Date assumes the AGM is held on 30 September.',
    penalty: { kind: 'per_day', amountPerDay: 100, note: '₹100 per day with no upper limit.' },
    applies: (p) => (isCompany(p) ? 'Every private limited company files an annual return with the Registrar.' : null),
    schedule: (year) => annualForPreviousYear(year, 11, 29),
  },

  // ----- MCA: LLPs ---------------------------------------------------------
  {
    id: 'llp-form11',
    title: 'Form 11: LLP annual return',
    form: 'LLP Form 11',
    category: 'MCA',
    authority: 'Ministry of Corporate Affairs',
    description: 'Annual return listing partners and their contributions, due within 60 days of year end.',
    penalty: { kind: 'variable', note: 'Additional fee that multiplies with the length of the delay.' },
    applies: (p) => (isLlp(p) ? 'Every LLP files an annual return, even with no business activity.' : null),
    schedule: (year) => annualForPreviousYear(year, 5, 30),
  },
  {
    id: 'llp-form8',
    title: 'Form 8: statement of account and solvency',
    form: 'LLP Form 8',
    category: 'MCA',
    authority: 'Ministry of Corporate Affairs',
    description: 'Partners declare the LLP is solvent and file its statement of assets and liabilities.',
    penalty: { kind: 'variable', note: 'Additional fee that multiplies with the length of the delay.' },
    applies: (p) => (isLlp(p) ? 'Every LLP files a statement of account and solvency each year.' : null),
    schedule: (year) => annualForPreviousYear(year, 10, 30),
  },
];
