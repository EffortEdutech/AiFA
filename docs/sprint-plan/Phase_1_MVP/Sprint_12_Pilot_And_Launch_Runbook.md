# Sprint 12 — Pilot & Launch Runbook

**Purpose:** everything in Sprint 12 that is genuinely the owner's to do — recruiting a real pilot, distributing a build, confirming production backend config, and closing out MVP Exit Criteria with evidence. Nothing in this document can be executed by an AI coding session: it requires real calendar time, a real external user, and real developer/vendor accounts. What the AI session already built (onboarding flow, bug-bash fixes) is recorded in `Checklist_Master.md` and the Sprint 12 report, not repeated here.

**Companion documents:** `Sprint_12_Pilot_Readiness_And_Launch.md` (the sprint's own task breakdown), `00_Sprint_Plan_Overview.md` §5 (the six MVP Exit Criteria this runbook exists to satisfy).

---

## 1. Recruit the pilot business owner

**Goal:** one real SME owner, genuinely running a business day-to-day, uses AIFA for two consecutive weeks — not a friendly tester who already knows the app.

- [ ] Identify a primary candidate. Best fit: someone who currently does bookkeeping in a notebook, spreadsheet, or messaging app (WhatsApp receipts, mental math) rather than an existing accounting-software user — closer to AIFA's actual target user.
- [ ] Identify a backup candidate in case the primary churns early (named risk in the sprint doc).
- [ ] Explain, in plain terms, what you're asking: two weeks of using AIFA for their actual daily expense/sale/purchase/banking capture, in exchange for early access and your direct support if anything breaks.
- [ ] Get their device platform (iOS/Android) confirmed before packaging distribution (Section 3) — the distribution track differs by platform.
- [ ] Set a concrete start date and calendar reminder for the two-week checkpoint.

## 2. Bug bash — what the AI session covered vs. what needs live-pilot eyes

The AI session's structured code review (Sprint 12 report, task #25) covered: the confirm/correct loop, ledger arithmetic in reversal-based corrections and bank reconciliation settlement, migration idempotency, deletion safety, and a concurrency race in the offline-resume path (found and fixed — two overlapping connectivity-flap resumes could no longer double-post before, but could double-write an AI interpretation history row; now guarded, with a regression test).

What a code review cannot surface — needs real pilot usage:

- [ ] Watch for anything that causes data loss, an incorrect financial figure, or a broken confirm/correct loop during the pilot window — these are launch-blocking by the sprint doc's own definition, regardless of when they surface.
- [ ] Check in with the pilot owner at least every few days during the two weeks, not only at the end — a problem caught on day 3 is cheaper to understand than one reconstructed from memory on day 14.
- [ ] Log anything surprising (a workflow AIFA doesn't cover, a confusing screen) as a Phase 2 candidate rather than trying to fix it mid-pilot, per the sprint doc's own risk mitigation.

## 3. Distribution packaging

This requires real developer accounts and signing credentials that only you hold — an AI session cannot create or hold these on your behalf.

### If iOS (TestFlight)
- [ ] Confirm you have an active Apple Developer Program membership (individual or org).
- [ ] In App Store Connect, create the app record (bundle identifier must match `app.json`/`app.config` — check `EXPO_PUBLIC_*` and native config for the current bundle id before creating the record, so they match exactly).
- [ ] Build a release binary (`eas build --platform ios` if using EAS, or an Xcode archive if building locally) and upload it to App Store Connect.
- [ ] Add your pilot owner's Apple ID email as an internal or external TestFlight tester.
- [ ] Confirm they've received and accepted the TestFlight invite, and that the build actually launches on their device before day 1 of the pilot.

### If Android (Play Console internal testing track)
- [ ] Confirm you have an active Google Play Console developer account.
- [ ] Create the app listing (package name must match your app config, same matching check as above).
- [ ] Build a release AAB (`eas build --platform android` if using EAS) and upload it to the internal testing track.
- [ ] Add your pilot owner's Google account email to the internal tester list and share the opt-in link.
- [ ] Confirm the install and first launch succeed on their actual device before day 1.

### Either platform
- [ ] Do a final signed-build smoke test yourself first — capture one expense, one sale, one banking transaction, confirm the dashboard reflects them — before handing the build to the pilot owner.

## 4. Confirm production backend configuration

An AI session must never read or print `.env` files or handle secrets directly — this section is a checklist for you to verify yourself, not something to hand over values for.

- [ ] Confirm the Supabase project used by the shipped build is the production project, not a development/test project (check the project ref in your build's environment configuration, not just its name).
- [ ] Confirm production-tier settings: appropriate compute/storage tier for at least one real user's ongoing usage, database backups enabled on Supabase's side (separate from AIFA's own app-level backup feature built in Sprint 9).
- [ ] Confirm Row Level Security policies are active on every table the app touches in production (should already be true from Sprint 10's security pass — this is a re-confirmation on the production project specifically, since dev and prod are separate Supabase projects with independently-configured policies).
- [ ] Confirm the production API keys/URLs baked into the distributed build are the production ones, not development ones left over from testing.
- [ ] Rotate any development-only keys that may have been used during earlier sprints' testing, if they have more access than the production build needs.

## 5. MVP Exit Criteria — evidence checklist

Walk through `00_Sprint_Plan_Overview.md` §5 explicitly. Do not check anything off from memory — attach the evidence type noted.

| # | Criterion | Evidence needed |
|---|---|---|
| 1 | Capture by voice, text, or photo works fully offline, nothing lost | A screen recording or dated note of an offline capture session, plus the app's own diagnostics (Settings → Diagnostics queued count) showing it resumed cleanly once back online |
| 2 | Sales/Purchase/Expense/Banking events interpreted correctly with confidence-based routing | A short log of real pilot captures across all four domains, noting which were auto-recorded, drafted, or clarified, and whether the routing matched what a human would expect |
| 3 | Dashboard shows accurate cash position, trend, receivables/payables from real data | A screenshot of the dashboard next to the pilot owner's own manual tally for the same period, confirming they match |
| 4 | AI CFO guidance with working explainability trail | A screenshot of at least one CFO guidance card and one "Why?" drill-down the pilot owner actually tapped, in their own words confirming it made sense |
| 5 | Data encrypted at rest, backed up, restorable on a new device login | A real restore test: sign in on a second device (or after a reinstall) and confirm the pilot owner's data reappears |
| 6 | Real business owner, two consecutive weeks, no data loss or trust-breaking AI error | The pilot log itself (Section 1-2 above) plus the two-week calendar span with dates |

## 6. After the pilot

- [ ] If all six criteria are satisfied with evidence: Phase 1 is complete. The next planning step is a Phase 2 scoping pass informed by real pilot feedback (Vol 0_1's Phase 2 list — multi-device sync, team access, additional domains, local AI, richer analytics) — tell the AI session explicitly to start that scoping pass when you're ready; it should not start on its own.
- [ ] If something genuinely launch-blocking surfaced: note it, decide whether it needs another focused sprint before calling Phase 1 done, and bring that back to the AI session as a new explicit instruction rather than treating Sprint 12 as silently reopened.

---

*End of Sprint 12 Pilot & Launch Runbook.*
