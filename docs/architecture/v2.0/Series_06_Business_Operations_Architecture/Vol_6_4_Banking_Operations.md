# AIFA — Banking Operations Architecture
## Volume 6_4 — Series 6: Business Operations Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

Defines how the banking domain instantiates the common operational pattern (Vol 6_0), and how it reconciles with sales, purchase, and expense events.

## 2. Business Event Types

| Event Type | Description |
|---|---|
| Deposit | Money received into a business bank account |
| Withdrawal | Money taken out of a business bank account |
| Transfer | Movement between the business's own accounts |
| Bank Fee | A charge levied by the bank |
| Reconciliation | Matching bank statement lines to recorded Business Events |

## 3. Domain Flow

```text
Bank notification received (SMS/email/import) or owner reports a transaction
        ↓
Business Event (Banking) captured
        ↓
Business Data: account, amount, counterparty, matched reference (if any)
        ↓
Bookkeeping Intelligence Engine: records cash movement, matches to receivable/payable if applicable
        ↓
Financial Intelligence Engine: tracks cash position, burn rate, runway
        ↓
AI CFO Assistant Engine: cash flow warnings, upcoming shortfall alerts
```

## 4. Reconciliation as a First-Class Flow

Because Business Events are canonical, reconciliation is framed as matching two independently captured event streams — bank-reported and owner-reported — rather than a single ledger being "corrected." Unmatched items are surfaced to the owner for resolution rather than silently forced to balance.

## 5. Governed Rules Sourced from the Finance PKA

- Bank fee classification
- Multi-currency conversion handling where applicable

## 6. Key Outputs to Financial Intelligence

- Real-time cash position
- Cash flow forecast inputs (paired with Vol 6_1/6_2 receivable/payable ageing)

## 7. Sprint 7 Concrete Implementation

Deposit, Withdrawal, Transfer, and Bank Fee are implemented as manual-entry-only Business Events (`app/src/db/bankingRepository.ts`, `app/src/components/BankTransactionForm.tsx`) — deliberately NOT run through the AI classification pipeline used by Expense/Sale/Purchase, since none of the four have an ambiguous category to guess (PKA rule `BANK-001`, `pka/accounting_rules.json`). "Reconciliation" (Business Event Type in Section 2, above) is not a separate event type in Phase 1; it is an optional property of a Deposit or Withdrawal.

Section 4's "reconciliation as matching two independently captured event streams" is implemented literally: a Deposit can optionally be matched to an outstanding Sale (`matchBusinessDataId`), and a Withdrawal to an outstanding Purchase — the owner-reported invoice/bill and the bank-reported cash movement are two separate Business Events from the start, and a match links them rather than editing either. A matched settlement posts new ledger entries against the ORIGINAL BusinessData's id (via a new `idVariant` on `LedgerEntryInput`, avoiding an id collision with that item's original entries), so the existing `getOutstandingReceivables`/`Payables` queries (Vol 6_1 §6, Vol 6_2 §6) net to zero for a fully settled item with no query-layer changes required. Every match is additionally logged to a new `bank_reconciliations` table purely for audit traceability — it plays no role in balance computation.

**Phase 1 limitation, by design:** settlement is full-amount-only (the Deposit/Withdrawal amount must equal the outstanding balance within a 0.005 tolerance); partial payment against an invoice or bill is explicitly not supported and is deferred, consistent with this sprint's own risk register. A type mismatch (e.g., a Deposit matched to a Purchase) and a double-settlement attempt against an already-reconciled item are both rejected rather than silently accepted.

Because Phase 1's chart of accounts has a single undifferentiated "Cash / Bank" line (no per-account granularity), a same-business Transfer posts zero ledger entries (both legs would hit the same account) but is still recorded as a Business Event for the audit trail — a documented limitation, not an oversight.

Bank fee classification (Section 5) is a single fixed account, `Operating Expenses:Bank Fees` (migration 6), not a governed classification rule requiring PKA judgment — there is nothing ambiguous to classify. Multi-currency conversion handling (Section 5) is not implemented in Phase 1.

## 8. Relationships to Other Volumes

- Vol 6_0 (Business Operations Architecture) defines the shared pattern this volume specialises.
- Vol 6_1 (Sales Operations) and Vol 6_2 (Purchase Operations) supply the receivable/payable side reconciled here.
- Vol 8_3 (Integration & API Architecture) covers optional bank feed integrations.

---

*End of Volume 6_4.*
