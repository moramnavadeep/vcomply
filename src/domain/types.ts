/** Calendar date without a time zone, always formatted YYYY-MM-DD. */
export type IsoDate = string;

export type EntityType = 'private_limited' | 'llp';
export type GstScheme = 'monthly' | 'qrmp';

/** The handful of facts about a company that decide which filings apply to it. */
export interface CompanyProfile {
  name: string;
  entityType: EntityType;
  /** Start year of the April–March window being tracked (2026 means Apr 2026 – Mar 2027). */
  complianceYear: number;
  gstRegistered: boolean;
  gstScheme: GstScheme;
  /** Annual turnover in ₹ lakh (100 lakh = 1 crore). */
  annualTurnoverLakh: number;
  deductsTds: boolean;
  employeeCount: number;
  pfRegistered: boolean;
  esiRegistered: boolean;
  expectsTaxLiability: boolean;
  hasOutstandingLoans: boolean;
}

export const CATEGORIES = ['GST', 'TDS', 'Payroll', 'Income Tax', 'MCA'] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * How lateness is punished. Only `per_day` and `flat` can be turned into a rupee
 * estimate; `variable` penalties depend on amounts we do not know (tax due, arrears).
 */
export type Penalty =
  | { kind: 'per_day'; amountPerDay: number; cap?: number; note: string }
  | { kind: 'flat'; amount: number; note: string }
  | { kind: 'variable'; note: string };

/** One dated occurrence of a rule, e.g. "GSTR-3B for October 2026". */
export interface Occurrence {
  /** Stable within a rule, so completions survive regenerating the calendar. */
  periodKey: string;
  periodLabel: string;
  dueDate: IsoDate;
}

export interface Rule {
  id: string;
  title: string;
  form: string;
  category: Category;
  authority: string;
  description: string;
  penalty: Penalty;
  /** Returns the plain-language reason the rule applies, or null when it does not. */
  applies(profile: CompanyProfile): string | null;
  /** Occurrences whose due date falls in the April–March window starting in `year`. */
  schedule(year: number): Occurrence[];
}

/** A rule occurrence resolved for one company: the unit the user actually works with. */
export interface Obligation {
  id: string;
  ruleId: string;
  title: string;
  form: string;
  category: Category;
  authority: string;
  description: string;
  reason: string;
  periodLabel: string;
  dueDate: IsoDate;
  penalty: Penalty;
}

export interface Completion {
  filedOn: IsoDate;
  /** Acknowledgement / ARN / SRN number: the evidence an auditor asks for. */
  reference: string;
  note: string;
  /** True when assumed filed during onboarding rather than recorded by the user. */
  backfilled: boolean;
}

export type Status = 'filed' | 'filed_late' | 'overdue' | 'due_soon' | 'upcoming';

export type ActivityType = 'profile_created' | 'profile_updated' | 'filed' | 'reopened' | 'imported';

export interface ActivityEntry {
  id: string;
  /** Full ISO timestamp. */
  at: string;
  type: ActivityType;
  obligationId?: string;
  message: string;
}

export interface AppState {
  version: 1;
  profile: CompanyProfile | null;
  completions: Record<string, Completion>;
  activity: ActivityEntry[];
}
