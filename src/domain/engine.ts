import { daysBetween } from './dates';
import { RULES } from './rules';
import type { CompanyProfile, Completion, IsoDate, Obligation, Penalty, Rule, Status } from './types';

/** Obligations due within this many days are flagged as "due soon". */
export const DUE_SOON_DAYS = 7;

/**
 * Turns a company profile into its full list of dated obligations for the
 * tracked year, sorted by due date. Pure: same profile in, same list out.
 */
export function generateObligations(profile: CompanyProfile, rules: Rule[] = RULES): Obligation[] {
  const obligations: Obligation[] = [];

  for (const rule of rules) {
    const reason = rule.applies(profile);
    if (reason === null) continue;

    for (const occurrence of rule.schedule(profile.complianceYear)) {
      obligations.push({
        id: `${rule.id}:${occurrence.periodKey}`,
        ruleId: rule.id,
        title: rule.title,
        form: rule.form,
        category: rule.category,
        authority: rule.authority,
        description: rule.description,
        reason,
        periodLabel: occurrence.periodLabel,
        dueDate: occurrence.dueDate,
        penalty: rule.penalty,
      });
    }
  }

  return obligations.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
}

export function getStatus(obligation: Obligation, completion: Completion | undefined, today: IsoDate): Status {
  if (completion) {
    return completion.filedOn > obligation.dueDate ? 'filed_late' : 'filed';
  }
  const daysLeft = daysBetween(today, obligation.dueDate);
  if (daysLeft < 0) return 'overdue';
  if (daysLeft <= DUE_SOON_DAYS) return 'due_soon';
  return 'upcoming';
}

/**
 * Days past the due date: measured to the filing date once filed, otherwise to today.
 * Never negative. Filing on the due date itself is on time.
 */
export function daysLate(obligation: Obligation, completion: Completion | undefined, today: IsoDate): number {
  const reference = completion ? completion.filedOn : today;
  return Math.max(0, daysBetween(obligation.dueDate, reference));
}

/**
 * Late fee in rupees for a given delay, or null when it cannot be computed
 * without knowing the tax amount involved.
 */
export function estimatePenalty(penalty: Penalty, lateDays: number): number | null {
  if (lateDays <= 0) return 0;
  switch (penalty.kind) {
    case 'per_day': {
      const fee = penalty.amountPerDay * lateDays;
      return penalty.cap === undefined ? fee : Math.min(fee, penalty.cap);
    }
    case 'flat':
      return penalty.amount;
    case 'variable':
      return null;
  }
}

export interface Summary {
  total: number;
  filed: number;
  overdue: number;
  dueSoon: number;
  upcoming: number;
  /** Indicative late fees already accrued on overdue items that have a computable fee. */
  exposure: number;
  /** How much `exposure` grows for every further day of inaction. */
  exposurePerDay: number;
  /** Overdue items whose cost depends on the unpaid amount, so it is not in `exposure`. */
  unquantifiedOverdue: number;
  /** Share of obligations due so far that were filed on time (0-100), or null if nothing was due yet. */
  onTimeRate: number | null;
}

export function summarize(
  obligations: Obligation[],
  completions: Record<string, Completion>,
  today: IsoDate,
): Summary {
  const summary: Summary = {
    total: obligations.length,
    filed: 0,
    overdue: 0,
    dueSoon: 0,
    upcoming: 0,
    exposure: 0,
    exposurePerDay: 0,
    unquantifiedOverdue: 0,
    onTimeRate: null,
  };
  let dueSoFar = 0;
  let filedOnTime = 0;

  for (const obligation of obligations) {
    const completion = completions[obligation.id];
    const status = getStatus(obligation, completion, today);
    if (obligation.dueDate < today) dueSoFar += 1;

    switch (status) {
      case 'filed':
        summary.filed += 1;
        if (obligation.dueDate < today) filedOnTime += 1;
        break;
      case 'filed_late':
        summary.filed += 1;
        break;
      case 'due_soon':
        summary.dueSoon += 1;
        break;
      case 'upcoming':
        summary.upcoming += 1;
        break;
      case 'overdue': {
        summary.overdue += 1;
        const late = daysLate(obligation, undefined, today);
        const fee = estimatePenalty(obligation.penalty, late);
        if (fee === null) {
          summary.unquantifiedOverdue += 1;
        } else {
          summary.exposure += fee;
          const feeTomorrow = estimatePenalty(obligation.penalty, late + 1) ?? fee;
          summary.exposurePerDay += feeTomorrow - fee;
        }
        break;
      }
    }
  }

  if (dueSoFar > 0) summary.onTimeRate = Math.round((filedOnTime / dueSoFar) * 100);
  return summary;
}
