import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { validateProfileForm, type FormValues } from './components/ProfileForm';
import { STORAGE_KEY } from './state/store';

/*
 * End-to-end flows through the real UI, with the clock pinned to 15 Nov 2026
 * so "overdue" and "due soon" are deterministic.
 */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 15, 10, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

async function onboard(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Company name'), 'Acme Pvt Ltd');
  await user.type(screen.getByLabelText('Annual turnover (₹ lakh)'), '320');
  await user.type(screen.getByLabelText('Number of employees'), '24');
}

describe('onboarding', () => {
  it('shows validation errors and stays on the form when submitted empty', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Build my calendar' }));

    expect(screen.getByText('Enter your company name.')).toBeInTheDocument();
    expect(screen.getByText(/Enter turnover as a number/)).toBeInTheDocument();
    expect(screen.getByText(/Enter a whole number of employees/)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('ticks PF and ESI automatically from the head count', async () => {
    const user = userEvent.setup();
    render(<App />);
    const pf = screen.getByRole('checkbox', { name: /Registered under EPF/ });
    const esi = screen.getByRole('checkbox', { name: /Registered under ESI/ });

    await user.type(screen.getByLabelText('Number of employees'), '12');
    expect(pf).not.toBeChecked();
    expect(esi).toBeChecked();

    await user.clear(screen.getByLabelText('Number of employees'));
    await user.type(screen.getByLabelText('Number of employees'), '20');
    expect(pf).toBeChecked();
  });

  it('builds a calendar with no false overdue alarms and saves it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await onboard(user);
    await user.click(screen.getByRole('button', { name: 'Build my calendar' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Acme Pvt Ltd' })).toBeInTheDocument();
    expect(screen.getByText('Nothing overdue')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').profile.name).toBe('Acme Pvt Ltd');
  });

  it('shows past deadlines as overdue when the user opts out of backfilling', async () => {
    const user = userEvent.setup();
    render(<App />);
    await onboard(user);
    await user.click(screen.getByRole('checkbox', { name: /Treat deadlines before today as already filed/ }));
    await user.click(screen.getByRole('button', { name: 'Build my calendar' }));

    expect(screen.queryByText('Nothing overdue')).not.toBeInTheDocument();
    expect(screen.getByText(/in late fees so far/)).toBeInTheDocument();
  });

  it('restores the saved calendar on the next visit', async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    await onboard(user);
    await user.click(screen.getByRole('button', { name: 'Build my calendar' }));
    first.unmount();

    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Acme Pvt Ltd' })).toBeInTheDocument();
  });
});

describe('working with filings', () => {
  async function loadSample(user: ReturnType<typeof userEvent.setup>) {
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Explore with a sample company' }));
  }

  it('loads a sample company with overdue filings and a rupee exposure', async () => {
    const user = userEvent.setup();
    await loadSample(user);

    expect(screen.getByRole('heading', { level: 1, name: 'Kaveri Labs Pvt Ltd' })).toBeInTheDocument();
    // GSTR-1 for October was due 11 Nov: 4 days late at ₹50 a day.
    expect(screen.getByText('₹200 in late fees so far')).toBeInTheDocument();
  });

  it('files an overdue return late, then reopens it', async () => {
    const user = userEvent.setup();
    await loadSample(user);

    await user.click(screen.getByRole('button', { name: /GSTR-1: outward supplies.*October 2026/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('You are GST-registered and file monthly returns.')).toBeInTheDocument();
    expect(within(dialog).getByText(/recorded as 4 days late.*₹200/)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Acknowledgement number/), 'ARN-123');
    await user.click(within(dialog).getByRole('button', { name: 'Mark as filed' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/in late fees so far/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Activity' }));
    expect(screen.getByText(/Filed GSTR-1 for October 2026 on 15 Nov 2026 \(late\), ref ARN-123/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Calendar' }));
    await user.click(screen.getByRole('button', { name: 'Filed' }));
    await user.click(screen.getByRole('button', { name: /GSTR-1: outward supplies.*October 2026/ }));
    expect(within(screen.getByRole('dialog')).getByText('ARN-123')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reopen this filing' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark as filed' })).toBeInTheDocument();
  });

  it('refuses a filing date in the future', async () => {
    const user = userEvent.setup();
    await loadSample(user);
    await user.click(screen.getByRole('button', { name: /GSTR-1: outward supplies.*October 2026/ }));
    const dialog = screen.getByRole('dialog');

    const date = within(dialog).getByLabelText('Filed on');
    await user.clear(date);
    await user.type(date, '2026-12-25');
    await user.click(within(dialog).getByRole('button', { name: 'Mark as filed' }));

    expect(within(dialog).getByText('The filing date cannot be in the future.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes the dialog with Escape', async () => {
    const user = userEvent.setup();
    await loadSample(user);
    await user.click(screen.getByRole('button', { name: /GSTR-1: outward supplies.*October 2026/ }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('filters the calendar and recovers from an empty search', async () => {
    const user = userEvent.setup();
    await loadSample(user);
    await user.click(screen.getByRole('button', { name: 'Calendar' }));

    await user.click(screen.getByRole('button', { name: 'Overdue' }));
    expect(screen.getByText('Showing 2 filings of 75')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search filings'), 'no such filing');
    expect(screen.getByText('No filings match these filters')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Showing 75 filings')).toBeInTheDocument();
  });

  it('keeps recorded filings when the profile is edited', async () => {
    const user = userEvent.setup();
    await loadSample(user);
    await user.click(screen.getByRole('button', { name: 'Settings & export' }));

    const name = screen.getByLabelText('Company name');
    await user.clear(name);
    await user.type(name, 'Kaveri Labs Renamed');
    await user.click(screen.getByRole('checkbox', { name: /Treat deadlines before today as already filed/ }));
    await user.click(screen.getByRole('button', { name: 'Save and regenerate calendar' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Kaveri Labs Renamed' })).toBeInTheDocument();
    expect(screen.getByText('₹200 in late fees so far')).toBeInTheDocument();
  });

  it('rejects a file that is not a backup, with a readable message', async () => {
    const user = userEvent.setup();
    await loadSample(user);
    await user.click(screen.getByRole('button', { name: 'Settings & export' }));

    await user.upload(screen.getByLabelText('Backup file'), new File(['not json at all'], 'notes.json', { type: 'application/json' }));
    expect(await screen.findByText(/not valid JSON/)).toBeInTheDocument();

    await user.upload(screen.getByLabelText('Backup file'), new File([JSON.stringify({ version: 7 })], 'old.json', { type: 'application/json' }));
    expect(await screen.findByText(/unsupported version/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Kaveri Labs Pvt Ltd' })).toBeInTheDocument();
  });

  it('deletes everything only after confirmation', async () => {
    const user = userEvent.setup();
    await loadSample(user);
    await user.click(screen.getByRole('button', { name: 'Settings & export' }));

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(screen.getByRole('button', { name: 'Delete all data' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Kaveri Labs Pvt Ltd' })).toBeInTheDocument();

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Delete all data' }));
    expect(screen.getByRole('button', { name: 'Build my calendar' })).toBeInTheDocument();
    confirm.mockRestore();
  });
});

describe('validateProfileForm', () => {
  const valid: FormValues = {
    name: '  Acme  ',
    entityType: 'private_limited',
    complianceYear: 2026,
    turnover: '320',
    gstRegistered: true,
    gstScheme: 'monthly',
    deductsTds: true,
    employees: '24',
    pfRegistered: true,
    esiRegistered: true,
    expectsTaxLiability: false,
    hasOutstandingLoans: true,
  };

  it('trims the name and converts numbers', () => {
    const { profile, errors } = validateProfileForm(valid);
    expect(errors).toEqual({});
    expect(profile).toMatchObject({ name: 'Acme', annualTurnoverLakh: 320, employeeCount: 24 });
  });

  it.each([
    ['a negative turnover', { turnover: '-1' }, 'turnover'],
    ['a non-numeric turnover', { turnover: 'abc' }, 'turnover'],
    ['a fractional head count', { employees: '2.5' }, 'employees'],
    ['a negative head count', { employees: '-3' }, 'employees'],
    ['a blank name', { name: '   ' }, 'name'],
  ] as const)('rejects %s', (_label, change, field) => {
    const { profile, errors } = validateProfileForm({ ...valid, ...change });
    expect(profile).toBeNull();
    expect(errors[field]).toBeTruthy();
  });

  it('accepts zero turnover and zero employees for a brand-new company', () => {
    expect(validateProfileForm({ ...valid, turnover: '0', employees: '0' }).profile).not.toBeNull();
  });

  it('blocks quarterly GST filing above the ₹5 crore QRMP limit', () => {
    expect(validateProfileForm({ ...valid, gstScheme: 'qrmp', turnover: '501' }).errors.gstScheme).toBeTruthy();
    expect(validateProfileForm({ ...valid, gstScheme: 'qrmp', turnover: '500' }).profile).not.toBeNull();
    expect(validateProfileForm({ ...valid, gstScheme: 'qrmp', turnover: '501', gstRegistered: false }).profile).not.toBeNull();
  });

  it('drops the loans answer for an LLP, where DPT-3 does not exist', () => {
    expect(validateProfileForm({ ...valid, entityType: 'llp' }).profile?.hasOutstandingLoans).toBe(false);
  });
});
