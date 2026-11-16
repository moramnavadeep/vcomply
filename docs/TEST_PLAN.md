# Test plan

## Approach

The risk in this product is concentrated in one place: **telling someone the wrong date, or the wrong filing.** So the bulk of automated testing targets the rules engine and date maths, which are pure functions and cheap to test exhaustively. UI tests then cover the flows a user actually walks through. Visual layout is checked by hand.

Run everything with `npm test`. CI runs type-check, tests and build on every push.

## Automated coverage (168 tests)

| Area | File | What is checked |
| --- | --- | --- |
| Date maths | `src/domain/dates.test.ts` | Impossible dates rejected (31 June, 29 Feb in a non-leap year); day counts across month, year and leap-day boundaries; April year start; "today" taken from local time, not UTC |
| Rule catalogue | `src/domain/engine.test.ts` | Every rule, for four different years: valid dates, inside the April to March window, unique period keys |
| Applicability | `src/domain/engine.test.ts` | Smallest company gets only unavoidable filings; LLP never gets company forms; each turnover threshold tested at the limit and one above; monthly vs quarterly GST; GST scheme ignored when unregistered |
| Schedules | `src/domain/engine.test.ts` | March TDS due 30 April, others the 7th; year-end TDS return due 31 May; PMT-06 skips quarter-end months; AGM, AOC-4, MGT-7 order |
| Status | `src/domain/engine.test.ts` | Upcoming, due soon and overdue on either side of each cut-off; filing on the due date is on time, the next day is late |
| Penalties | `src/domain/engine.test.ts` | Per-day fee, cap reached and held, no cap, flat fee, and refusing to estimate interest-based penalties |
| Summary | `src/domain/engine.test.ts` | Statuses add up to the total; exposure and daily growth; growth stops at the cap; late filings lower the on-time rate |
| State | `src/state/store.test.ts` | Backfill covers only past dates and never overwrites real records; reopen; immutability; unique log ids |
| Untrusted input | `src/state/store.test.ts` | Ten kinds of malformed backup rejected; corrupt localStorage falls back to a clean start; storage write failure reported, not thrown |
| iCalendar | `src/export/export.test.ts` | CRLF endings; every line within 75 bytes; multi-byte `₹` never split; escaping; stable UIDs; empty calendar |
| CSV | `src/export/export.test.ts` | Quoting; formula-injection guard on free text; numbers left intact |
| API | `server/app.test.ts` | Real HTTP against the Express app: registration rules, duplicate email, identical answer for wrong password and unknown email, hash never returned, rate limit, token tampering, revision conflict returns newer state, accounts isolated, malformed JSON, oversized body, feed contents and 404s, CORS allow-list |
| Sync | `src/sync/sync.test.tsx` | Scripted fake API: new device adopts account data, failed sign-in, unreachable server leaves the app usable, upload after edits, adopting a newer version on conflict, sign-out keeps local data |
| UI flows | `src/App.test.tsx` | Onboarding validation; PF/ESI defaults from head count; persistence across reload; file late and reopen; future date refused; Escape closes dialog; filters and empty search; profile edit keeps records; bad backup files; delete needs confirmation |

## Edge cases handled deliberately

| Case | Behaviour |
| --- | --- |
| Company onboarded mid-year | Earlier deadlines are treated as filed (opt-out), labelled "Assumed filed" |
| Obligation due today | "Due today", counted as due soon, not overdue, and never backfilled |
| Filing date in the future | Rejected with a message |
| Quarterly GST chosen above ₹5 crore turnover | Rejected: the scheme is not available |
| Profile edited after filings recorded | Calendar regenerates; records are kept, even for filings that stop applying |
| Penalty depends on unpaid tax | Excluded from the rupee total and called out separately |
| Browser blocks localStorage | Warning banner; the app keeps working for the session |
| Backup that is not JSON, wrong version, or too large | Readable error; existing data untouched |
| Formula typed into a note field | Neutralised in the CSV export |
| Zero turnover, zero employees | Accepted: a brand-new company is a valid user |
| Sync server unreachable or asleep | Message shown; all local features keep working |
| Two devices save at once | Second save is rejected and that device adopts the first |
| Sign in on a device that already has different data | Asks which copy to keep |

## Manual checklist

Performed in Chromium before submission.

- [x] Empty form shows three field errors and does not proceed
- [x] Valid form builds the calendar; head count of 22 ticks both PF and ESI
- [x] Dashboard figures match the calendar (filed + open = total)
- [x] Filing dialog opens, records an acknowledgement number, and the activity log shows it
- [x] Sample company shows two overdue items and a rupee exposure
- [x] 375 px wide viewport: no horizontal scrolling, all controls reachable
- [x] Local API: sign up, sign in from a wiped browser, wrong password, live feed, conflict from a second writer
- [x] Deployed API with Postgres, by script with a throwaway account: sign up, duplicate email (409), sign in, wrong password (401), save, stale save (409), read back identical to what was sent, feed with the expected 28 events, unknown feed (404), no token (401), CORS allows only the frontend origin, delete account (204) then token rejected (401)
- [ ] `.ics` file imports into Google Calendar with reminders (verify after deploy)
- [ ] CSV opens in Excel with `₹` and dates intact (verify after deploy)
- [ ] Dark mode contrast on a device set to dark
- [ ] Print preview of the calendar

## Not tested

- Browsers other than Chromium.
- The Postgres store, in automated tests: the API suite runs against the in-memory store that implements the same interface.
- Correctness of the statutory rules against primary sources: they are encoded from my understanding of the law and listed as a limitation in the README.
