# Sprint 53 — Quick Capture (AI) Smoke Test

**Purpose:** verify the Path B-retargeted router actually posts into the real
Ledger/Cash Book/Approvals data the rest of the app reads — not just that it type
-checks. Do this before marking Sprint 53 genuinely done (see `Checklist_Master.md`).

**Where:** the "Quick Capture (AI)" sidebar item (top of the sidebar, under
Overview), in the running web app against your local Supabase instance.

---

## Before you start — one-time setup check

Quick Capture reuses existing data, it doesn't create parties/categories/leave
types itself. Confirm these already exist for the business you're testing with (if
any are missing, create them first on their normal page — this is a five-minute
one-time setup, not part of the test itself):

- [ ] At least one **Party** that is NOT flagged `employee` (a supplier/payee) —
      Parties page
- [ ] At least one **Party** flagged `employee` — Parties page (edit an existing
      party's type, or create one, and tick Employee)
- [ ] At least one **Chart of Accounts** entry with type `expense` — Chart of
      Accounts page
- [ ] At least one **Leave Type** (e.g. "Annual Leave") — Attendance & Leave page
      → Leave Types section
- [ ] That employee has a **Leave Balance** granted for that leave type/year with
      enough days for the dates you'll use in Test 2 below — Attendance & Leave
      page → Grant Balance section (the RPC throws `insufficient_leave_balance`
      otherwise — that's a correct rejection, not a bug, if you skip this)

---

## Test 1 — Expense (Path B: `createPaymentVoucher`)

1. Open **Quick Capture (AI)**.
2. Type: `Paid RM45 to Grab for petrol`
3. Click **Detect**.
   - **Expect:** dropdown shows "Expense (auto-detected)", amount field pre-filled
     `45`.
   - **If it doesn't detect Expense:** the amount regex likely didn't match — note
     the exact text you typed and stop here, that's a real bug to report back.
4. Pick a Payee (any existing party) and a Category (any expense-type account).
   Leave payment method as `cash` or change it. Amount should already say `45`.
5. Click **Confirm & Save**.
   - **Expect:** a success message ("Recorded as a Payment Voucher…"), the form
     clears, and no error banner.
6. Navigate to **Payment Vouchers**.
   - **Expect:** a new voucher dated today, for RM45, with the payee/category you
     picked, and the notes field containing your original raw text
     ("Paid RM45 to Grab for petrol").
7. **CORRECTED (6 September 2026, found during the real smoke test run):**
   `create_payment_voucher` only opens an approval task (draft → approved) — it
   deliberately does NOT post the ledger yet (same two-step flow the dedicated
   Expense page already uses; see `mark_payment_voucher_paid` in the migration).
   Cash Book / P&L / Full Reports only count *paid* vouchers, cash-basis. So:
   - Confirm the voucher's status is `approved` (a solo business self-resolves the
     approval task immediately; a team business may need an explicit approve on
     the **Approvals** page first).
   - Click **Mark Paid** on the voucher.
   - THEN go to **Cash Book / P&L** → **Profit & Loss** tab (Cash Book itself also
     needs a `bank_accounts` row seeded — see the smoke-test seed script — and
     only counts vouchers paid via a method tied to that account) → Refresh.
8. **This is the critical check** — the whole point of the Path B retarget: confirm
   the RM45 actually moved the numbers on **Profit & Loss** (Total Expense RM45.00,
   under the category you picked) after being marked paid.

**Pass condition:** the capture is visible on Payment Vouchers immediately, AND
once marked paid, is reflected in Profit & Loss — proving both halves of the real
lifecycle work, not just that a row appeared in a list.

---

## Test 2 — Leave Application (Path B: `createLeaveApplication`)

1. Open **Quick Capture (AI)** (fresh, after Test 1's form reset).
2. Type: `Ahmad applying annual leave 2026-09-14 to 2026-09-16`
   (swap in your actual test employee's first name if you like — the name in the
   text is NOT parsed, it's just context for you; you still pick the employee from
   a dropdown in step 4)
3. Click **Detect**.
   - **Expect:** dropdown shows "Leave application (auto-detected)", both date
     fields pre-filled `2026-09-14` / `2026-09-16`.
4. Pick the Employee (your test employee) and Leave Type from the dropdowns. Dates
   should already be filled from step 3 — adjust if needed.
5. Click **Confirm & Save**.
   - **Expect:** success message ("Leave application submitted — see it on the
     Approvals page"), form clears.
   - **If you see `insufficient_leave_balance`:** go back and grant that
     employee/leave type/year a bigger balance (see setup checklist), then repeat
     from step 1 — this is a correct rejection, not a router bug.
6. Click the **Approvals** link in the page's own description text (or navigate to
   the Approvals sidebar item directly).
   - **Expect:** a new pending Approval Task for this leave application. For a
     solo/single-owner business, check whether it's already auto-resolved
     (`solo_self_resolved`) per the existing solo-approval rule — either outcome is
     correct, just confirm it matches what Attendance & Leave's own form does for
     the same business type.
7. Navigate to **Attendance & Leave** → Leave Applications list.
   - **Expect:** the new application appears there too, dates matching what you
     entered, same record the Approvals page is tracking — proving this is the
     same real `leave_applications` row the dedicated page uses, not a shadow copy.

**Pass condition:** a real Approval Task exists and the same leave application is
visible on Attendance & Leave's own list.

---

## Test 3 — Unclassified (new: `capture_triage`)

1. Open **Quick Capture (AI)**.
2. Type something with no leave keyword and no parseable amount, e.g.:
   `Need to call the landlord about the aircon`
3. Click **Detect**.
   - **Expect:** dropdown shows "Unclassified (couldn't tell — goes to triage)
     (auto-detected)", no resolved-fields form appears, just the explanatory note.
4. Click **Confirm & Save**.
   - **Expect:** success message ("Couldn't confidently classify this — saved to
     your Unclassified Triage list below"), form clears.
5. Scroll down to the **Unclassified Triage** table on the same page.
   - **Expect:** your exact text appears as a new row, with today's timestamp.
6. Click **Mark handled** on that row.
   - **Expect:** the row disappears from the list (status moved to `resolved`,
     which the list only shows `pending` items for).
7. Optional — repeat steps 2-4 with a second throwaway line, then click
   **Dismiss** instead, and confirm it also disappears.

**Pass condition:** the item appears, persists across a page reload (refresh the
browser and re-open Quick Capture — the list re-fetches from Supabase, so this also
proves it's a real row, not local-only state), and both resolution actions work.

---

## Test 4 — Manual override (the "not right? pick a different type" path)

This exists specifically so a misdetection never forces a bad post — worth
proving once.

1. Type something the heuristic will get "wrong" on purpose, e.g.:
   `RM20 for annual leave application fee` (contains both an amount AND the word
   "leave" — the router prioritises leave keywords, so this will auto-detect as
   Leave application even though you mean it as an expense).
2. Click **Detect** — confirm it shows "Leave application (auto-detected)".
3. Use the dropdown next to "Detected as:" to manually switch it to **Expense**.
   - **Expect:** the form below switches to the expense fields (payee/category/
     amount), amount will be blank (the heuristic only pre-fills on its own
     detected path) — fill it in manually as `20`.
4. Confirm & Save as in Test 1, and verify it lands as an Expense, not a leave
   application.

**Pass condition:** the override actually changes which RPC gets called — check
Payment Vouchers (should have the new RM20 line), NOT Attendance & Leave.

---

## What a clean run tells us

If Tests 1-4 all pass, Sprint 53 is genuinely done, not just type-checked: real
data is landing in the real Ledger/Approvals/Attendance pages through the exact
same RPCs those pages use, and the triage/override safety nets work. Report back
which tests passed/failed and I'll fix or update the Checklist accordingly before
we move to Sprint 54.
