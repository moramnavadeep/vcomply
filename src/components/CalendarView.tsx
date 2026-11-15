import { useMemo, useState } from 'react';
import { formatMonthYear } from '../domain/dates';
import { getStatus } from '../domain/engine';
import { CATEGORIES, type Category, type Completion, type IsoDate, type Obligation } from '../domain/types';
import { EmptyState, ObligationRow, plural } from './common';

type StatusFilter = 'all' | 'open' | 'overdue' | 'filed';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'filed', label: 'Filed' },
];

interface CalendarViewProps {
  obligations: Obligation[];
  completions: Record<string, Completion>;
  today: IsoDate;
  onOpen: (obligation: Obligation) => void;
}

export function CalendarView({ obligations, completions, today, onOpen }: CalendarViewProps) {
  // Opens on what is left to do; the filed history is one click away.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return obligations.filter((obligation) => {
      const status = getStatus(obligation, completions[obligation.id], today);
      const isFiled = status === 'filed' || status === 'filed_late';
      if (statusFilter === 'open' && isFiled) return false;
      if (statusFilter === 'filed' && !isFiled) return false;
      if (statusFilter === 'overdue' && status !== 'overdue') return false;
      if (category !== 'all' && obligation.category !== category) return false;
      if (needle && !`${obligation.title} ${obligation.form} ${obligation.periodLabel}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [obligations, completions, today, statusFilter, category, query]);

  const months = useMemo(() => groupByMonth(visible), [visible]);
  const availableCategories = CATEGORIES.filter((c) => obligations.some((o) => o.category === c));
  const isFiltered = visible.length !== obligations.length;

  function clearFilters() {
    setStatusFilter('all');
    setCategory('all');
    setQuery('');
  }

  return (
    <div className="stack">
      <section className="card filters no-print" aria-label="Filters">
        <div className="segmented" role="group" aria-label="Filter by status">
          {STATUS_FILTERS.map((option) => (
            <button key={option.value} type="button" className={statusFilter === option.value ? 'is-active' : ''} aria-pressed={statusFilter === option.value} onClick={() => setStatusFilter(option.value)}>
              {option.label}
            </button>
          ))}
        </div>
        <div className="field field-inline">
          <label htmlFor="cal-category" className="visually-hidden">Filter by area</label>
          <select id="cal-category" value={category} onChange={(e) => setCategory(e.target.value as Category | 'all')}>
            <option value="all">All areas</option>
            {availableCategories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="field field-inline field-grow">
          <label htmlFor="cal-search" className="visually-hidden">Search filings</label>
          <input id="cal-search" type="search" placeholder="Search, e.g. GSTR-3B or October" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button type="button" className="btn" onClick={() => window.print()}>Print</button>
      </section>

      <p className="result-count" role="status">
        Showing {plural(visible.length, 'filing')}
        {isFiltered && ` of ${obligations.length}`}
      </p>

      {months.length === 0 ? (
        <section className="card">
          <EmptyState title="No filings match these filters">
            <button type="button" className="btn btn-link" onClick={clearFilters}>Clear filters</button>
          </EmptyState>
        </section>
      ) : (
        months.map(({ month, items }) => (
          <section className="card" key={month}>
            <header className="card-header">
              <h2>{month}</h2>
              <span className="count">{items.length}</span>
            </header>
            <ul className="rows">
              {items.map((o) => (
                <ObligationRow key={o.id} obligation={o} completion={completions[o.id]} today={today} onOpen={onOpen} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

/** Groups date-sorted obligations under "November 2026"-style headings, preserving order. */
function groupByMonth(obligations: Obligation[]): { month: string; items: Obligation[] }[] {
  const groups: { month: string; items: Obligation[] }[] = [];
  for (const obligation of obligations) {
    const month = formatMonthYear(obligation.dueDate);
    const last = groups.at(-1);
    if (last && last.month === month) last.items.push(obligation);
    else groups.push({ month, items: [obligation] });
  }
  return groups;
}
