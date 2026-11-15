import type { ActivityEntry, ActivityType } from '../domain/types';
import { EmptyState } from './common';

const TYPE_LABELS: Record<ActivityType, string> = {
  profile_created: 'Setup',
  profile_updated: 'Profile',
  filed: 'Filed',
  reopened: 'Reopened',
  imported: 'Restore',
};

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Append-only history of every change: the "who did what, when" an auditor asks for. */
export function ActivityLog({ activity }: { activity: ActivityEntry[] }) {
  const newestFirst = [...activity].reverse();

  return (
    <section className="card">
      <header className="card-header">
        <h2>Activity log</h2>
        <span className="count">{activity.length}</span>
      </header>
      <p className="card-intro">Every filing, reopening and profile change is recorded here. Niyam never edits or removes an entry.</p>
      {newestFirst.length === 0 ? (
        <EmptyState title="No activity yet" />
      ) : (
        <ol className="log">
          {newestFirst.map((entry) => (
            <li key={entry.id}>
              <span className={`log-type log-${entry.type}`}>{TYPE_LABELS[entry.type] ?? entry.type}</span>
              <span className="log-message">{entry.message}</span>
              <time dateTime={entry.at}>{formatTimestamp(entry.at)}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
