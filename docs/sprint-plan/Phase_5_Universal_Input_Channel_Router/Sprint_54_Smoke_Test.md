# Sprint 54 — Forward to AiFA Smoke Test

**Purpose:** verify the new "Forward to AiFA" screen genuinely shares Sprint 53's
Path B core rather than being a lookalike copy — and that the deferred image/PDF
drop zone fails honestly instead of silently.

**Where:** the new "Forward to AiFA" sidebar item (just below "Quick Capture (AI)"),
in the running web app against your local Supabase instance. Uses the same
parties/leave-type/leave-balance seed data as Sprint 53's smoke test — no new setup
needed if you already ran that.

---

## Test 1 — Forwarded expense text

1. Open **Forward to AiFA**.
2. Leave the source picker on "Forwarded from WhatsApp".
3. Paste: `Paid RM30 to Shell for petrol`
4. Click **Detect**.
   - **Expect:** same "Expense (auto-detected)" behaviour as Quick Capture, amount
     pre-filled `30`.
5. Pick a payee and category, **Confirm & Save**.
6. Check **Payment Vouchers** — a new RM30 voucher should appear, same as if you'd
   typed it into Quick Capture directly.

**Pass condition:** identical outcome to Sprint 53's Test 1, just entered from this
new screen.

## Test 2 — Forwarded leave text

1. Switch the source picker to "Forwarded from Email".
2. Paste a leave-application line (e.g. `Ahmad applying annual leave 2026-09-20 to
   2026-09-21`), Detect, pick employee/leave type, Confirm & Save.
2. Check **Approvals** / **Attendance & Leave** — should behave exactly like Sprint
   53's Test 2 (auto-approved if solo business).

**Pass condition:** identical outcome to Sprint 53's Test 2.

## Test 3 — Unclassified from this screen

1. Paste something with no leave keyword and no amount, e.g. `Landlord wants to
   discuss the lease renewal`.
2. Detect → Unclassified → Confirm & Save.
3. Confirm the item shows up in **Unclassified Triage** on this same page.
4. Switch to **Quick Capture (AI)** — confirm the SAME item also shows up there.

**Pass condition:** the triage list is shared, not per-screen — proving both pages
read the same `capture_triage` table, not separate state.

## Test 4 — Image/PDF drop zone is honestly disabled

1. On **Forward to AiFA**, look at the drop zone below the text box.
2. Confirm it clearly states image/PDF forwarding isn't available yet, rather than
   silently accepting a drop and doing nothing (or crashing).

**Pass condition:** no crash, no silent no-op — the limitation is visible.

---

If all 4 pass, Sprint 54 is genuinely done. Report back which passed/failed.
