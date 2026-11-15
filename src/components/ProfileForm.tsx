import { useState, type FormEvent } from 'react';
import { complianceYearOf, financialYearLabel } from '../domain/dates';
import { THRESHOLDS } from '../domain/rules';
import type { CompanyProfile, EntityType, GstScheme, IsoDate } from '../domain/types';

/** QRMP (quarterly GST returns) is only open to businesses up to ₹5 crore turnover. */
const QRMP_LIMIT_LAKH = 500;

export interface FormValues {
  name: string;
  entityType: EntityType;
  complianceYear: number;
  turnover: string;
  gstRegistered: boolean;
  gstScheme: GstScheme;
  deductsTds: boolean;
  employees: string;
  pfRegistered: boolean;
  esiRegistered: boolean;
  expectsTaxLiability: boolean;
  hasOutstandingLoans: boolean;
}

type FormErrors = Partial<Record<'name' | 'turnover' | 'employees' | 'gstScheme', string>>;

function toFormValues(profile: CompanyProfile | null, today: IsoDate): FormValues {
  return {
    name: profile?.name ?? '',
    entityType: profile?.entityType ?? 'private_limited',
    complianceYear: profile?.complianceYear ?? complianceYearOf(today),
    turnover: profile ? String(profile.annualTurnoverLakh) : '',
    gstRegistered: profile?.gstRegistered ?? true,
    gstScheme: profile?.gstScheme ?? 'monthly',
    deductsTds: profile?.deductsTds ?? true,
    employees: profile ? String(profile.employeeCount) : '',
    pfRegistered: profile?.pfRegistered ?? false,
    esiRegistered: profile?.esiRegistered ?? false,
    expectsTaxLiability: profile?.expectsTaxLiability ?? false,
    hasOutstandingLoans: profile?.hasOutstandingLoans ?? false,
  };
}

/** Validates the form. Exported so the rules can be unit-tested without rendering. */
export function validateProfileForm(values: FormValues): { errors: FormErrors; profile: CompanyProfile | null } {
  const errors: FormErrors = {};
  const name = values.name.trim();
  const turnover = Number(values.turnover);
  const employees = Number(values.employees);

  if (!name) errors.name = 'Enter your company name.';
  if (values.turnover.trim() === '' || !Number.isFinite(turnover) || turnover < 0) {
    errors.turnover = 'Enter turnover as a number of lakhs, 0 or more.';
  }
  if (values.employees.trim() === '' || !Number.isInteger(employees) || employees < 0) {
    errors.employees = 'Enter a whole number of employees, 0 or more.';
  }
  if (values.gstRegistered && values.gstScheme === 'qrmp' && turnover > QRMP_LIMIT_LAKH) {
    errors.gstScheme = 'Quarterly filing (QRMP) is only available up to ₹5 crore turnover. Choose monthly.';
  }
  if (Object.keys(errors).length > 0) return { errors, profile: null };

  return {
    errors,
    profile: {
      name,
      entityType: values.entityType,
      complianceYear: values.complianceYear,
      gstRegistered: values.gstRegistered,
      gstScheme: values.gstScheme,
      annualTurnoverLakh: turnover,
      deductsTds: values.deductsTds,
      employeeCount: employees,
      pfRegistered: values.pfRegistered,
      esiRegistered: values.esiRegistered,
      expectsTaxLiability: values.expectsTaxLiability,
      // DPT-3 is a company-only filing, so the answer is meaningless for an LLP.
      hasOutstandingLoans: values.entityType === 'private_limited' && values.hasOutstandingLoans,
    },
  };
}

interface ProfileFormProps {
  initial: CompanyProfile | null;
  today: IsoDate;
  submitLabel: string;
  onSubmit: (profile: CompanyProfile, backfill: boolean) => void;
}

export function ProfileForm({ initial, today, submitLabel, onSubmit }: ProfileFormProps) {
  const [values, setValues] = useState<FormValues>(() => toFormValues(initial, today));
  const [backfill, setBackfill] = useState(true);
  const [errors, setErrors] = useState<FormErrors>({});
  const currentYear = complianceYearOf(today);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  /** Head count drives the PF/ESI defaults, but the user can still override them (voluntary registration). */
  function setEmployees(raw: string) {
    const count = Number(raw);
    setValues((previous) => ({
      ...previous,
      employees: raw,
      pfRegistered: Number.isFinite(count) && count >= THRESHOLDS.pfEmployees,
      esiRegistered: Number.isFinite(count) && count >= THRESHOLDS.esiEmployees,
    }));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const result = validateProfileForm(values);
    setErrors(result.errors);
    if (result.profile) onSubmit(result.profile, backfill);
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="pf-name">Company name</label>
        <input id="pf-name" type="text" value={values.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'pf-name-error' : undefined} maxLength={80} autoComplete="organization" />
        {errors.name && <p className="field-error" id="pf-name-error">{errors.name}</p>}
      </div>

      <div className="field-grid">
        <div className="field">
          <label htmlFor="pf-entity">Type of entity</label>
          <select id="pf-entity" value={values.entityType} onChange={(e) => set('entityType', e.target.value as EntityType)}>
            <option value="private_limited">Private limited company</option>
            <option value="llp">Limited liability partnership (LLP)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="pf-year">Year to track</label>
          <select id="pf-year" value={values.complianceYear} onChange={(e) => set('complianceYear', Number(e.target.value))}>
            {[currentYear - 1, currentYear, currentYear + 1].map((year) => (
              <option key={year} value={year}>
                Apr {year} – Mar {year + 1} ({financialYearLabel(year)})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field-grid">
        <div className="field">
          <label htmlFor="pf-turnover">Annual turnover (₹ lakh)</label>
          <input id="pf-turnover" type="number" inputMode="decimal" min="0" step="any" placeholder="e.g. 320 for ₹3.2 crore" value={values.turnover} onChange={(e) => set('turnover', e.target.value)} aria-invalid={!!errors.turnover} aria-describedby={errors.turnover ? 'pf-turnover-error' : undefined} />
          {errors.turnover && <p className="field-error" id="pf-turnover-error">{errors.turnover}</p>}
        </div>
        <div className="field">
          <label htmlFor="pf-employees">Number of employees</label>
          <input id="pf-employees" type="number" inputMode="numeric" min="0" step="1" placeholder="e.g. 24" value={values.employees} onChange={(e) => setEmployees(e.target.value)} aria-invalid={!!errors.employees} aria-describedby={errors.employees ? 'pf-employees-error' : undefined} />
          {errors.employees && <p className="field-error" id="pf-employees-error">{errors.employees}</p>}
        </div>
      </div>

      <fieldset className="checks">
        <legend>What applies to you?</legend>

        <label className="check">
          <input type="checkbox" checked={values.gstRegistered} onChange={(e) => set('gstRegistered', e.target.checked)} />
          <span>
            <strong>Registered for GST</strong>
            <small>You have a GSTIN and charge GST on invoices.</small>
          </span>
        </label>
        {values.gstRegistered && (
          <div className="field nested">
            <label htmlFor="pf-scheme">GST return frequency</label>
            <select id="pf-scheme" value={values.gstScheme} onChange={(e) => set('gstScheme', e.target.value as GstScheme)} aria-invalid={!!errors.gstScheme} aria-describedby={errors.gstScheme ? 'pf-scheme-error' : undefined}>
              <option value="monthly">Monthly returns</option>
              <option value="qrmp">Quarterly returns, monthly payment (QRMP)</option>
            </select>
            {errors.gstScheme && <p className="field-error" id="pf-scheme-error">{errors.gstScheme}</p>}
          </div>
        )}

        <label className="check">
          <input type="checkbox" checked={values.deductsTds} onChange={(e) => set('deductsTds', e.target.checked)} />
          <span>
            <strong>Deducts TDS</strong>
            <small>On salaries, rent, or contractor and professional fees.</small>
          </span>
        </label>

        <label className="check">
          <input type="checkbox" checked={values.pfRegistered} onChange={(e) => set('pfRegistered', e.target.checked)} />
          <span>
            <strong>Registered under EPF</strong>
            <small>Mandatory from {THRESHOLDS.pfEmployees} employees; ticked automatically from your head count.</small>
          </span>
        </label>

        <label className="check">
          <input type="checkbox" checked={values.esiRegistered} onChange={(e) => set('esiRegistered', e.target.checked)} />
          <span>
            <strong>Registered under ESI</strong>
            <small>Mandatory from {THRESHOLDS.esiEmployees} employees; ticked automatically from your head count.</small>
          </span>
        </label>

        <label className="check">
          <input type="checkbox" checked={values.expectsTaxLiability} onChange={(e) => set('expectsTaxLiability', e.target.checked)} />
          <span>
            <strong>Expects to owe income tax this year</strong>
            <small>Profitable enough that tax for the year will be ₹10,000 or more.</small>
          </span>
        </label>

        {values.entityType === 'private_limited' && (
          <label className="check">
            <input type="checkbox" checked={values.hasOutstandingLoans} onChange={(e) => set('hasOutstandingLoans', e.target.checked)} />
            <span>
              <strong>Has loans outstanding</strong>
              <small>Including money lent to the company by its directors.</small>
            </span>
          </label>
        )}
      </fieldset>

      <label className="check check-plain">
        <input type="checkbox" checked={backfill} onChange={(e) => setBackfill(e.target.checked)} />
        <span>
          <strong>Treat deadlines before today as already filed</strong>
          <small>Untick this if you want to go through past filings one by one.</small>
        </span>
      </label>

      <button type="submit" className="btn btn-primary">{submitLabel}</button>
    </form>
  );
}
