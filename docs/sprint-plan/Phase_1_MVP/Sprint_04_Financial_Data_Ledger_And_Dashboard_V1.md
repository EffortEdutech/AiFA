# Sprint 4 — Financial Data / Ledger & Dashboard v1

**Duration:** Weeks 7–8
**Architecture references:** Vol 4_1 (Financial Data Architecture), Vol 11_1 §4 (schema), Vol 7_3 (Mobile Dashboard Architecture), Vol 0_1 §6 (reduced launch scope)

---

## Theme

Sprint 3 produces classified expenses; this sprint turns them into a real, auditable ledger and shows the owner something true and useful on a dashboard — the first moment AIFA feels like a finished product rather than a capture tool.

## Objectives

Every recorded expense has a correct, balanced `LedgerEntry`; the dashboard shows real cash position and trend numbers computed from that ledger, not placeholders.

## Task Breakdown

### Ledger Implementation
- Implement `LedgerEntry` per Vol 11_1 §4, using the Phase 1 chart-of-accounts subset (§4.1)
- Every BIE-classified expense produces a balanced debit/credit pair
- Implement reversal-based correction: editing a confirmed entry creates a `reversal_of` pair, never an in-place edit (Vol 4_1 §4)
- Unit tests proving debits always equal credits across any sequence of captures and corrections

### Dashboard v1
- Cash position panel (today's balance, computed live from `LedgerEntry`) — Vol 7_3 §2
- Money in / money out trend (rolling 30-day, since there won't be 90 days of data yet) — Vol 0_1 §6
- Recent Business Events panel (upgrades Sprint 2's activity feed)
- Business-language only — no ledger/account-code terminology surfaced (Vol 1_2, Vol 7_3 §3)
- Dashboard reads local Financial Data only — no network round-trip required to render (Vol 7_3 §4)

### Confirm/Correct UX Polish
- The draft-confirm flow from Sprint 3 gets a real UI treatment: one-tap confirm, easy correct
- Corrections feed back into the ledger via the reversal mechanism above

## Definition of Done

- [ ] Every recorded expense has a balanced ledger entry, verified by an automated balance-check test
- [ ] Correcting a confirmed entry produces a reversal, never a silent edit
- [ ] The dashboard's cash position and trend numbers are demonstrably correct against a hand-calculated test scenario
- [ ] Dashboard renders instantly offline against local data
- [ ] No accounting terminology (debit/credit/journal/ledger) appears anywhere in the dashboard UI

## Dependencies

Sprint 3's classification pipeline output.

## Risks

| Risk | Mitigation |
|---|---|
| Ledger bugs are invisible until numbers look wrong later | Write the balance-check test suite now, run it on every future sprint that touches the ledger |
| Temptation to add the full KPI/ratio library from Vol 2_3 | Explicitly out of scope — Vol 0_1 §6 caps Phase 1 dashboard content; resist expanding until Phase 2 |

## Safe to Carry Over

Dashboard visual/animation polish can slip; the underlying numbers must not.

---

*End of Sprint 4.*
