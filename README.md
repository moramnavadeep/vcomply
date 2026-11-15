# Niyam

**A personalised statutory compliance calendar for Indian startups.**
Answer a few questions about your company and get every GST, TDS, PF/ESI, income-tax and MCA deadline that applies to you for the year, with the reason it applies and what being late costs.

- **Live app:** https://moramnavadeep.github.io/vcomply/
- **Product write-up:** [docs/PRODUCT_WRITEUP.md](docs/PRODUCT_WRITEUP.md)
- **Test plan:** [docs/TEST_PLAN.md](docs/TEST_PLAN.md)

*Niyam (नियम) is Hindi for "rule".*

## The problem

A newly incorporated Indian company with ten employees has roughly 60 to 75 statutory deadlines a year, spread across five authorities (GST Portal, Income Tax, EPFO, ESIC, MCA), each with its own calendar and penalty. Missing one is not a warning: it is ₹50 to ₹200 **per day**, or interest at 12 to 18% a year, and for some filings personal liability for directors.

## Who it is for

The founder or operations lead of an early-stage private limited company or LLP (roughly 1 to 50 people) who has **no in-house finance or compliance person**. They rely on an outside CA who works on request and reminds them over WhatsApp, usually the day before a deadline.

## Why existing options fall short

| Option | Where it breaks for this user |
| --- | --- |
| Generic compliance calendars (PDFs, blog posts) | List *every* due date for *every* kind of business. The founder has to work out which 70 of 300 lines are theirs. |
| A spreadsheet | Someone has to build it, know the rules to build it right, and remember to look at it. No reminders, no history. |
| The CA's reminders | Arrive late, live in chat, and leave no record of what was filed or when. |
| Enterprise GRC and tax suites | Built for compliance teams: per-seat pricing, onboarding calls, far more than a ten-person company needs. |

Niyam's improvement is narrow and specific: **only the filings that apply to you, each with a plain-language reason, a rupee cost for being late, and a record of when you filed it.**

## What it does

1. **Personalised calendar.** Eleven questions (entity type, turnover, head count, registrations) run through a rules engine of 22 filing rules to produce the dated obligations for an April to March year.
2. **Explains itself.** Every obligation shows what it is, *why it applies to this company* ("Your turnover (₹3.2 crore) is above the ₹2 crore limit"), and the penalty.
3. **Puts a price on delay.** The dashboard adds up late fees already accrued and how fast they grow ("₹200 in late fees so far, growing by ₹50 every day you wait"). Where the penalty is interest on an unknown amount, it says so instead of inventing a number.
4. **Records evidence.** Mark a filing done with its date and acknowledgement number. Late filings are flagged. Every change lands in an append-only activity log.
5. **Fits existing tools.** Export open deadlines as an `.ics` file (Google Calendar, Outlook) with a reminder three days ahead; export a CSV compliance register for the CA or an auditor; print the calendar.
6. **Private by design.** No account and no server. Data stays in the browser, with JSON backup and restore to move it.
7. **Try it without typing.** "Explore with a sample company" loads a realistic mid-year state, including two missed deadlines.

## Run it locally

Requires Node.js 20 or newer.

```bash
git clone https://github.com/moramnavadeep/vcomply.git
cd vcomply
npm install
npm run dev
```

Then open the URL Vite prints (normally http://localhost:5173).

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server with hot reload |
| `npm test` | Run the 129 unit and UI tests once |
| `npm run typecheck` | Type-check with strict TypeScript |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build locally |

There are no environment variables, API keys or secrets: the app has no backend.

## Deployment

The build is fully static (`dist/`) and uses relative asset paths, so it runs on any static host.

- **GitHub Pages (configured):** `.github/workflows/ci.yml` type-checks, tests and builds on every push, and deploys `main` to Pages. One-time setup: *Settings → Pages → Source → GitHub Actions*.
- **Vercel / Netlify:** import the repository; the build command is `npm run build` and the output directory is `dist` (`netlify.toml` is included).

## How the code is organised

```
src/
  domain/        Pure business logic, no React
    types.ts       Data model
    dates.ts       Calendar-date maths (UTC, no time zones)
    rules.ts       The rule catalogue: one entry per statutory filing
    engine.ts      Profile -> obligations, status, penalty estimates, summary
  state/
    store.ts       Reducer, validation, localStorage persistence, sample data
  export/        iCalendar, CSV and file download
  components/    Screens: onboarding form, dashboard, calendar, filing dialog, log, settings
  App.tsx        Wires state to screens
```

Design choices worth knowing before reading the code:

- **Rules are data.** Each filing is one object in `rules.ts` with two small pure functions: `applies(profile)` returns the reason it applies (or `null`), and `schedule(year)` returns its due dates. Adding a filing touches one file.
- **The reducer never reads the clock.** Every action carries its own timestamp and "today", so state transitions are pure and tested without mocking time.
- **Obligation ids are stable** (`gstr3b-monthly:2026-10`). Editing the company profile regenerates the calendar without losing filing records.
- **Everything untrusted is validated.** The same `parseState` guards both localStorage and imported backups; corrupt data falls back to a clean start rather than a crash.

## Testing

129 automated tests (Vitest + Testing Library) run in CI on every push:

- **Rules engine:** applicability thresholds at their boundaries, every schedule's dates, statuses on either side of each cut-off, penalty caps.
- **State:** backfill, reopen, profile edits preserving records, ten kinds of malformed backup, storage quota failure.
- **Exports:** RFC 5545 line folding (including multi-byte `₹`), escaping, CSV formula-injection guard.
- **UI flows:** onboarding validation, filing late, reopening, filters, restore errors, delete confirmation.

The manual checklist and the reasoning behind what is and is not automated are in [docs/TEST_PLAN.md](docs/TEST_PLAN.md).

## Known limitations

- **Not legal or tax advice.** The rule set (version `2026.11`) reflects my understanding of the central rules and should be confirmed with a CA or CS. Due dates extended by government notification are not picked up automatically.
- **Central laws only.** State-level obligations (professional tax, shops and establishments, labour welfare fund) are out of scope because they differ across states.
- **Indicative penalties.** Late fees are statutory per-day or flat amounts at their upper slab. Interest on unpaid tax is not estimated because the app does not know the tax amount.
- **Familiar form names.** Income-tax forms are shown under their long-standing names (24Q, 26Q, Form 16, 3CD); the Income-tax Act, 2025 renumbers some of them.
- **Simplifying assumptions.** AOC-4 and MGT-7 dates assume the AGM is held on 30 September. The tax-audit threshold assumes at least 95% digital receipts. QRMP GSTR-3B uses the 22nd (some states get the 24th). Weekends and public holidays do not shift dates.
- **One browser, one company.** Data lives in `localStorage`: clearing site data deletes it (use Backup), and there is no multi-user access or sync.
- **No push or email reminders.** Reminders come from the exported calendar file.
- **Dark mode** follows the system setting and has had less visual testing than light mode.

## Built with

[React](https://react.dev) 19, [TypeScript](https://www.typescriptlang.org), [Vite](https://vite.dev), [Vitest](https://vitest.dev) and [Testing Library](https://testing-library.com). No UI kit, template or starter was used; styling is hand-written CSS.

I used Claude Code as an AI pair programmer while building this, as the assignment permits. The product decisions, rule set and trade-offs are mine, and I can walk through every part of the code.
