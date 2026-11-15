# Product write-up

## 1. The problem and the user

A small Indian company faces 60 to 75 statutory deadlines a year across GST, TDS, PF/ESI, income tax and MCA. Missing one costs ₹50 to ₹200 per day, or 12 to 18% interest.

The user is the founder or operations lead of a 1 to 50 person private limited company or LLP with no in-house finance person. Today they depend on a CA's last-minute WhatsApp reminders, or on generic calendars that list every due date for every kind of business. Niyam asks eleven questions and returns only their deadlines, each with the reason it applies, the cost of being late, and a record of when it was filed.

## 2. The most important decisions

**Explain every obligation.** Each rule returns the reason it applies ("Your turnover is above the ₹2 crore limit"), not just yes or no. A founder will not act on a deadline they cannot verify. This shaped the engine: rules are data, with an `applies` function that returns a sentence.

**Show the cost in rupees.** "2 overdue" is easy to ignore; "₹200 so far, growing ₹50 a day" is not. Where a penalty depends on unpaid tax, the app says so rather than inventing a figure.

**No backend, no sign-up.** Data stays in the browser, with file backup. Anyone gets value within a minute and compliance data never leaves the device. The price is no sync and no email reminders, which calendar export partly covers.

## 3. What I cut, and what comes next

Cut: state-level laws (they differ by state), multi-user access, email reminders, document upload, holiday-adjusted dates.

Next: government-notified due-date extensions, which is where static calendars go stale; then a read-only view to share with the CA; then state rules, one state at a time.

## 4. What broke or surprised me

**Onboarding mid-year.** A company starting in November opened to 44 "overdue" items that were, in reality, filed long ago. A tool that greets you with false alarms gets closed. I added an opt-out step that treats earlier deadlines as filed and labels them "assumed", so real records stay distinguishable.

**Dates.** Taking "today" from a UTC timestamp gives yesterday's date before 5:30 AM in India, hiding a deadline that has just passed. All arithmetic now runs on plain calendar dates, with tests.

**Penalties are not uniform.** I expected one formula. There are capped per-day fees, flat fees and interest, so I modelled three kinds and total only what is computable.
