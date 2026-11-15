import { addDays, formatDate, formatInr } from '../domain/dates';
import { getStatus, type Summary } from '../domain/engine';
import { CATEGORIES, type Completion, type IsoDate, type Obligation } from '../domain/types';
import { EmptyState, ObligationRow, plural } from './common';

/** How far ahead the "Coming up" list looks. */
const LOOKAHEAD_DAYS = 30;

interface DashboardProps {
  obligations: Obligation[];
  completions: Record<string, Completion>;
  summary: Summary;
  today: IsoDate;
  onOpen: (obligation: Obligation) => void;
  onViewCalendar: () => void;
}

export function Dashboard({ obligations, completions, summary, today, onOpen, onViewCalendar }: DashboardProps) {
  const open = obligations.filter((o) => !completions[o.id]);
  const overdue = open.filter((o) => getStatus(o, undefined, today) === 'overdue');
  const horizon = addDays(today, LOOKAHEAD_DAYS);
  const comingUp = open.filter((o) => o.dueDate >= today && o.dueDate <= horizon);
  const nextBeyond = open.find((o) => o.dueDate > horizon);

  return (
    <div className="stack">
      <section className="stats" aria-label="Summary">
        <StatCard
          label="On-time rate"
          value={summary.onTimeRate === null ? '–' : `${summary.onTimeRate}%`}
          hint={summary.onTimeRate === null ? 'Nothing has fallen due yet' : 'of deadlines so far were met'}
        />
        <StatCard label="Overdue" value={String(summary.overdue)} hint={summary.overdue === 0 ? 'Nothing is late' : 'need action now'} tone={summary.overdue > 0 ? 'danger' : 'good'} />
        <StatCard label="Due in 7 days" value={String(summary.dueSoon)} hint={summary.dueSoon === 0 ? 'A quiet week' : 'coming up this week'} tone={summary.dueSoon > 0 ? 'warn' : undefined} />
        <StatCard label="Filed this year" value={`${summary.filed}/${summary.total}`} hint={`${summary.total - summary.filed} still to go`}>
          <div className="meter" role="img" aria-label={`${summary.filed} of ${summary.total} filed`}>
            <span style={{ width: `${summary.total === 0 ? 0 : (summary.filed / summary.total) * 100}%` }} />
          </div>
        </StatCard>
      </section>

      {summary.overdue > 0 && <ExposureBanner summary={summary} />}

      <section className="card">
        <header className="card-header">
          <h2>Overdue</h2>
          {overdue.length > 0 && <span className="count count-danger">{overdue.length}</span>}
        </header>
        {overdue.length === 0 ? (
          <EmptyState title="Nothing overdue">Every deadline up to today is accounted for.</EmptyState>
        ) : (
          <ul className="rows">
            {overdue.map((o) => (
              <ObligationRow key={o.id} obligation={o} completion={undefined} today={today} onOpen={onOpen} />
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <header className="card-header">
          <h2>Coming up in the next {LOOKAHEAD_DAYS} days</h2>
          <button type="button" className="btn btn-link" onClick={onViewCalendar}>Full calendar</button>
        </header>
        {comingUp.length === 0 ? (
          <EmptyState title="Nothing due in the next 30 days">
            {nextBeyond ? `Next deadline: ${nextBeyond.form} on ${formatDate(nextBeyond.dueDate)}.` : 'No open deadlines are left in this year.'}
          </EmptyState>
        ) : (
          <ul className="rows">
            {comingUp.map((o) => (
              <ObligationRow key={o.id} obligation={o} completion={undefined} today={today} onOpen={onOpen} />
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <header className="card-header">
          <h2>Progress by area</h2>
        </header>
        <CategoryProgress obligations={obligations} completions={completions} />
      </section>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  hint: string;
  tone?: 'danger' | 'warn' | 'good';
  children?: React.ReactNode;
}

function StatCard({ label, value, hint, tone, children }: StatCardProps) {
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ''}`}>
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {children}
      <p className="stat-hint">{hint}</p>
    </div>
  );
}

/** Puts a rupee figure on inaction: the fastest way to make a missed deadline feel urgent. */
function ExposureBanner({ summary }: { summary: Summary }) {
  const quantified = summary.overdue - summary.unquantifiedOverdue;
  return (
    <section className="banner banner-danger" role="status">
      {quantified > 0 ? (
        <p>
          <strong>{formatInr(summary.exposure)} in late fees so far</strong>
          {summary.exposurePerDay > 0 && <>, growing by {formatInr(summary.exposurePerDay)} every day you wait</>}.
        </p>
      ) : (
        <p>
          <strong>{plural(summary.overdue, 'overdue item')} accruing interest.</strong>
        </p>
      )}
      <p className="banner-note">
        {summary.unquantifiedOverdue > 0 && quantified > 0 && (
          <>Interest on the unpaid amount for {plural(summary.unquantifiedOverdue, 'more overdue item')} is not included. </>
        )}
        Figures are indicative statutory late fees and exclude interest on tax.
      </p>
    </section>
  );
}

function CategoryProgress({ obligations, completions }: Pick<DashboardProps, 'obligations' | 'completions'>) {
  const rows = CATEGORIES.map((category) => {
    const items = obligations.filter((o) => o.category === category);
    return { category, total: items.length, filed: items.filter((o) => completions[o.id]).length };
  }).filter((row) => row.total > 0);

  return (
    <ul className="progress-list">
      {rows.map(({ category, total, filed }) => (
        <li key={category}>
          <span className="progress-name">{category}</span>
          <div className="meter" role="img" aria-label={`${category}: ${filed} of ${total} filed`}>
            <span style={{ width: `${(filed / total) * 100}%` }} />
          </div>
          <span className="progress-count">{filed}/{total}</span>
        </li>
      ))}
    </ul>
  );
}
