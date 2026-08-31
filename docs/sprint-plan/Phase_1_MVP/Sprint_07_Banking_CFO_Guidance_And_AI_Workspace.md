# Sprint 7 — Banking, CFO Guidance v1 & AI Workspace

**Duration:** Weeks 13–14
**Architecture references:** Vol 6_4 (Banking Operations, manual entry), Vol 2_4 (AI CFO Assistant Engine), Vol 0_1 §6 (reduced guidance scope), Vol 7_2 (AI Workspace Architecture)

---

## Theme

This sprint closes out the four Phase 1 operational domains (Vol 0_1 §4) with Banking, and turns on the first real advisory layer — the "AI Does the Rest" half of the promise, not just the bookkeeping half.

## Objectives

Bank transactions can be manually logged and reconciled against receivables/payables; the owner can see a small, high-confidence set of AI CFO observations and ask follow-up questions in a conversational workspace.

## Task Breakdown

### Banking (Manual Entry Only, Vol 0_1 §4)
- Manual bank transaction entry: deposit, withdrawal, transfer, bank fee (Vol 6_4 §2)
- Basic reconciliation: matching a bank transaction to an existing receivable/payable (Vol 6_4 §4) — no automated bank feed import in Phase 1

### CFO Guidance v1 (the exact Vol 0_1 §6 set, nothing more)
- Cash position (already on dashboard since Sprint 4)
- Money in/out trend (already on dashboard since Sprint 4)
- Overdue receivables list → generate a specific, prioritised observation, not just the raw list
- Upcoming payables list → same treatment
- One prioritised "thing to look at today," at most, surfaced once per day

### AI Workspace v1
- Conversational surface (Vol 7_2 §2) where the owner can ask free-form questions
- Answers reasoned over the same PCB-based pipeline (Vol 5_3), scoped to what's actually in Financial Data — no fabricated answers outside governed scope (Vol 1_4 §7)
- Explicit "I can't answer that reliably" response path for out-of-scope questions

## Definition of Done

- [ ] Manual bank entries reconcile correctly against existing receivables/payables
- [ ] The daily "thing to look at" recommendation is demonstrably correct against test scenarios (e.g., genuinely overdue invoice triggers it; nothing overdue means no false alarm)
- [ ] AI Workspace answers cite their source (Business Event or ledger figure) per the explainability data captured since Sprint 3
- [ ] Out-of-scope questions get an honest "can't answer that" response, never a guess

## Dependencies

Sprint 6's Sales/Purchase receivables and payables; Sprint 4's dashboard and ledger.

## Risks

| Risk | Mitigation |
|---|---|
| Temptation to build the full Vol 2_3 KPI/ratio library now that advisory is "on" | Stay within the Vol 0_1 §6 cap — broader analysis is Phase 2 |
| AI Workspace scope creep into open-ended chat | Keep it scoped to financial questions answerable from real data; this is not a general chatbot |

## Safe to Carry Over

Bank reconciliation UX polish (e.g., smart-matching suggestions) can be simplified to manual matching only, refined later.

---

*End of Sprint 7.*
