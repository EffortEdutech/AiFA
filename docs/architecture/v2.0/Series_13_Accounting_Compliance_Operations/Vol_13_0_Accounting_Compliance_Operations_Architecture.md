# AIFA — Accounting & Compliance Operations Architecture (Malaysia)
## Volume 13_0 — Series 13: SME Accounting & Compliance Modules — Version 1.1 (Sprint 21 Sign-Off Applied)

**Status:** Proposed, V1.1 — Open Items 1, 2, 4, 5 resolved at Sprint 21 design sign-off; Purchase Operations gap closed (new Section 4a); still design authority only, no code written against it beyond what Phase 3's sprint plan explicitly authorises sprint by sprint
**Prepared:** 2 September 2026
**Amended:** 2 September 2026 — Sprint 21 Design Sign-Off (see Section 14a)
**Requested by:** Business owner, in response to: "I did not see any accounting feature in AiFA yet — both web and mobile only serve basic input." Feature list supplied in Bahasa Malaysia (Invois & Quotation, Harga & Kos Jualan, Perbelanjaan & Untung Rugi, Penghantaran & Inventori, Laporan Akaun, e-Invois & SST, Payroll & Penggajian, Pengurusan Syarikat Lengkap, Legal & Commercial), preserved verbatim as Appendix A.
**Reads against:** Vol 0_0 (Master Index), Vol 0_1 (MVP & Phased Delivery Roadmap), Series 4 (Data Architecture), Series 6 (Business Operations Architecture — Vol 6_1 Sales, 6_2 Purchase, 6_3 Expense, 6_4 Banking, 6_5 Inventory, 6_6 Asset, 6_7 Payroll, 6_9 Tax), Vol 11_1 (MVP Data Schema), current `app/backend/schema.sql` and `packages/core/src/db/schema.ts`.

**Governing instruction for this volume:** *study, do not rush, produce a comprehensive modular design.* This is a design study, not a sprint. Nothing in this volume authorises schema changes, migrations, or code. Per the project's standing rule, no sprint begins against this volume without the owner's explicit, separate go-ahead — most likely sequenced through a new Phase (see Section 13).

---

## 1. Why This Volume Exists

Series 6 (Business Operations Architecture) already names nine of the domains the owner is asking for — Sales, Purchase, Expense, Banking, Inventory, Asset, Payroll, Project, Tax — and Vol 0_1's phase map already schedules most of them for Phase 2. That is good news: the owner is not asking for something architecturally new, they are asking AiFA to actually *become* what Series 6 already describes, instead of stopping at Sprint 1-12's single wedge (AI-interpreted expense/sale/purchase capture, one flat revenue/expense category each, no documents, no customers, no inventory, no payroll).

Two things in the owner's request are genuinely new, not yet named anywhere in the v2.0 set:

- **Pengurusan Syarikat Lengkap** (attendance, GPS clock-in/out, overtime, leave management, commission) — closest existing volume is 6_7 Payroll, but attendance/leave/commission are their own domain with their own approval workflows, not payroll line items.
- **Legal & Commercial** (contract storage, renewal alerts, e-signature, credit limit enforcement) — no existing volume covers this at all.

This volume treats the whole request as one connected system (as the owner does — "the concept is still the same: user gives input and AiFA works all the way to the human approval stage and continues until the end of the task") rather than nine disconnected features, because in practice they share one spine: a **Party** (customer/supplier/employee/agent), a **Document** (quotation → invoice → DO → payment; PV → expense; payslip; contract), and an **Approval** (the point where AI's draft becomes the owner's committed record). Sections 2-3 define that shared spine once; Sections 4-12 specialise it per module, in the same order the owner listed them.

## 2. Positioning Against the Existing Architecture

```text
                    Business Event Layer  (Vol 4_0 — unchanged, canonical)
                            │
        ┌───────────────────┼───────────────────────────────────┐
        │                   │                                   │
  Simple events        Document-centred events            Compliance events
  (Vol 6_1-6_4 today:  (NEW — this volume: Quotation,      (NEW — this volume:
  one amount, one      Invoice, DO, Payslip, Contract —    e-Invoice submission,
  category, no lines)  each has line items, a lifecycle    SST return, statutory
                        of states, and its own approval)    contribution filing)
        │                   │                                   │
        └───────────────────┼───────────────────────────────────┘
                            ▼
              Bookkeeping Intelligence Engine (Vol 2_2, unchanged boundary)
                            ▼
              Financial Data — Journal / Ledger / Trial Balance (Vol 4_1)
                            ▼
              Financial Intelligence Engine + AI CFO Assistant (Vol 2_3/2_4)
```

Nothing here replaces the Business Event → Business Data → Ledger pipeline; it extends it. The difference is that today's `BusinessData` (Vol 11_1 §3) is a flat `{counterparty, amount, category}` row, because "office stationery RM250" really is that flat. "Invoice ABC Trading 10 units of Product X at stokis price, on 30-day credit, deliver from Warehouse 1" is not flat — it has line items, a price source, a credit term, and a downstream inventory and payment consequence. Document-centred modules therefore introduce a **document header + document lines** shape *underneath* `BusinessData`, with `BusinessData` continuing to hold the one row that actually posts to the ledger (its `document_ref` pointing at the full document). Every module below follows this same two-layer shape so the existing BIE/ledger contract never has to special-case a domain.

## 3. Shared Foundations (built once, used by every module below)

### 3.1 Party — one table, not nine

Customer, supplier, employee, sales agent, and contract counterparty are the same underlying concept (a person or company AiFA transacts with) with different capability flags, not different tables. One `parties` table avoids the classic SME-software failure mode of a customer who is also a supplier existing as two disconnected records.

```text
Party
├── id                    string, unique, format "PTY-NNNNNN"
├── business_id           string, foreign key
├── display_name          string
├── legal_name            string, nullable — for e-Invoice/contract use
├── party_types           set of: customer | supplier | employee | agent | dropship_partner
├── registration_no       string, nullable — SSM/company registration
├── tin                   string, nullable — LHDN Tax Identification Number (Section 9)
├── sst_reg_no            string, nullable
├── contact_phone         string, nullable — WhatsApp send target (Section 4)
├── contact_email         string, nullable
├── billing_address       string, nullable
├── price_type_id         string, nullable, foreign key → PriceType (Section 5) — customer only
├── credit_limit           decimal, nullable — customer only (Section 12)
├── credit_terms_days      integer, nullable — customer only (Section 12)
├── status                enum: active | inactive
└── created_at            timestamp
```

A `Party` gains employee-specific fields only when `party_types` includes `employee` (Section 10), keeping the payroll-sensitive columns (bank account, statutory numbers) in a linked `EmployeeProfile` table rather than on the shared row — this matters directly for Section 14's access-control note.

### 3.2 Document header/line pattern

Every multi-line business document in this volume (Quotation, Invoice, Delivery Order, Payment Voucher, Payslip) shares one shape:

```text
DocumentHeader (specialised per type — Sections 4, 7, 8, 10)
├── id                    string, unique, format "<PREFIX>-YYYYMM-NNNN" (Section 3.4)
├── business_id           string
├── party_id              string, foreign key → Party
├── business_event_id     string, foreign key → BusinessEvent (Vol 4_0) — the capture that created it
├── status                enum, per-type lifecycle (each module states its own)
├── issue_date            date
├── currency              string, ISO 4217 — MYR by default
├── subtotal              decimal
├── tax_total             decimal
├── grand_total           decimal
├── notes                 string, nullable
├── created_by            string — "ai" | party/user id, for audit (Vol 4_1 §4)
└── created_at            timestamp

DocumentLine
├── id                    string, unique
├── document_id           string, foreign key → DocumentHeader
├── line_no               integer
├── product_id            string, nullable, foreign key → Product (Section 8)
├── description           string
├── quantity              decimal
├── unit_price             decimal
├── unit_cost              decimal, nullable — margin visibility (Section 5)
├── tax_code               string, nullable — SST code (Section 9)
├── line_total             decimal
└── discount_amount        decimal, nullable
```

### 3.3 Approval — the "AI works to human approval, then continues" pattern, generalised

The owner's stated concept ("user gives input and AiFA works all the way to the human approval stage and continues until the end of the task") already exists narrowly, as Vol 0_1 §5's three-band confidence routing for a single expense classification. Document-centred modules need the same idea applied to a whole multi-step task, not one field. This volume proposes one shared table so every module (quotation send, PV approval, leave approval, payroll run, contract signature request) reuses the same mechanism instead of nine bespoke approval flows:

```text
ApprovalTask
├── id                    string, unique
├── business_id           string
├── subject_type          enum: quotation | invoice | payment_voucher | delivery_order |
│                              stock_adjustment | leave_application | payroll_run |
│                              contract | e_invoice_submission
├── subject_id             string — id of the row in subject_type's own table
├── ai_draft_summary        string — plain-language "here is what I'm about to do"
├── ai_confidence            decimal, 0.00-1.00 — reuses Vol 0_1 §5 bands where the task
│                                                  is itself a classification (e.g. expense
│                                                  category on a PV); null where the task is
│                                                  purely structural (e.g. "send this invoice")
├── status                  enum: pending_approval | approved | rejected | auto_approved
├── decided_by               string, nullable
├── decided_at                timestamp, nullable
├── next_action               string, nullable — what fires automatically once approved
│                                                 (e.g. "send WhatsApp", "post to ledger",
│                                                 "reduce inventory", "lock credit limit check")
└── created_at                timestamp
```

`auto_approved` exists for the same reason Vol 0_1 §5's ≥90% band exists: not every draft needs a tap. A recurring monthly rent PV matched to last month's confirmed PV at ≥90% pattern confidence should post itself, exactly like a ≥90% expense does today; a first-time RM18,000 contract renewal should not. Per-module confidence thresholds are an Open Item (Section 14), not decided in this volume.

### 3.4 Document numbering

`document_number_sequences` (`business_id`, `document_type`, `prefix`, `next_number`, `reset_period`: `never | yearly | monthly`) — one row per document type per business, so an owner's own invoice/quotation/DO/PV numbering (a real, named requirement — "sesuai dengan bisnes") is configurable rather than hardcoded, consistent with how Finance PKA already externalises jurisdiction rules rather than inlining them (Vol 3_0).

## 4. Module A — Invois & Quotation (extends Vol 6_1 Sales Operations)

**Business Event types (extends Vol 6_1 §2):** `Quotation Created`, `Quotation Sent`, `Quotation Accepted`, `Quotation Rejected`, `Quotation Expired`, `Invoice Issued` *(already exists)*, `Invoice Sent`, `Payment Received` *(currently deferred to Sprint 7 per Vol 6_1 §6 — this volume assumes it ships alongside this module, since "rekod bayaran dan hutang pelanggan" is explicit in the owner's request)*, `Credit Note Issued`, `Delivery Order Linked`.

**Schema (specialising Section 3.2):**

```text
Quotation : DocumentHeader
├── status: draft | sent | accepted | rejected | expired | converted_to_invoice
├── valid_until           date
└── converted_invoice_id  string, nullable

Invoice : DocumentHeader
├── status: draft | issued | sent | partially_paid | paid | overdue | cancelled
├── due_date              date        — computed from Party.credit_terms_days
├── source_quotation_id    string, nullable
├── delivery_order_id      string, nullable, foreign key → DeliveryOrder (Section 8)
├── e_invoice_status        enum: not_applicable | pending | validated | rejected (Section 9)
└── outstanding_balance     decimal — derived from linked Payments

Payment
├── id                     string, unique
├── invoice_id              string, foreign key → Invoice
├── amount                  decimal
├── method                  enum: cash | bank_transfer | cheque | card | e_wallet
├── received_at              date
└── reference                string, nullable

CreditNote : DocumentHeader
└── source_invoice_id        string, foreign key → Invoice
```

**Domain flow:**

```text
Owner: "Quote ABC Trading 10 units Product X, stokis price, 30 days credit"
        ↓
Business Event (Quotation) captured → AI resolves Party, PriceList lookup (Module B),
credit term default from Party.credit_terms_days, drafts Quotation + lines
        ↓
ApprovalTask (subject_type=quotation, next_action="send WhatsApp") — owner reviews, taps approve
        ↓
Quotation sent via WhatsApp (pre-filled message + PDF/link, Section 4.1) — status: sent
        ↓
Owner marks Accepted (or customer replies, if a reply channel exists later) → one-tap "Convert to Invoice"
        ↓
Invoice created, e_invoice_status set per Section 9, linked to Delivery Order (Module D)
        ↓
Bookkeeping Intelligence Engine posts Accounts Receivable + Sales Revenue (same posting rule
SALE-001 already governs, per Vol 6_1 §6 — no change to that PKA rule, only its trigger point)
        ↓
Payment recorded (partial or full) → posts Cash/Bank debit, AR credit → Invoice.status updates
        ↓
Financial Intelligence Engine: real AR ageing (buckets, not the current flat list — Vol 6_1 §6
names this as a Phase 2/3 gap this module now closes) → AI CFO: overdue-invoice follow-up nudges
```

### 4.1 WhatsApp send

Two viable integration shapes were named as an Open Item: (a) **WhatsApp Business Platform (Cloud API)** — sends a templated message with a PDF/link automatically, requires a Meta Business/WABA account and template pre-approval, no user action beyond initial setup; (b) **`wa.me` click-to-chat** — AiFA generates the message text and PDF, opens WhatsApp with it pre-filled, owner taps send themselves — zero external account setup, but not "AiFA sends it," the owner does, each time.

**Resolved at Sprint 21 sign-off (2 September 2026): (b) click-to-chat.** The owner chose the zero-external-setup path so Sprint 28 isn't blocked on Meta/WABA account and template approval timelines. Sprint 28's build target is click-to-chat only; Business Platform automation remains a credible later upgrade (the message/PDF-generation logic underneath is the same either way) but is not scheduled.

## 4a. Module A' — Purchase Operations (extends Vol 6_2 Purchase Operations) — added at Sprint 21 sign-off

Flagged as a gap at Sprint 21 (Vol 13_2 §8.1): every other module got a Section number matching the owner's original list; Purchase Operations (Vol 6_2) never did, even though Section 5's cost-auto-calculation and Section 7's `purchase_receipt` stock movements both assume a `PurchaseInvoice` exists. This is a stub — enough to support those two dependents, not a full module design; a fuller Purchase-side design (supplier price lists, purchase approval workflow parity with Sales) is deferred, not attempted here.

**Business Event types (extends Vol 6_2, itself a Phase 1 launch domain per Vol 0_1 §4 already):** `Purchase Invoice Received` *(already exists as flat capture)*, `Purchase Order Issued` *(not built — out of scope for this stub)*.

```text
PurchaseInvoice : DocumentHeader (Section 3.2)
├── status                 enum: draft | received | paid
├── supplier_party_id         string, foreign key → Party (party_types ⊇ {supplier})
└── linked_stock_movement_ids   array — StockMovement(purchase_receipt) rows this invoice generated
```

**Domain flow:** owner captures a purchase ("Bought 100 units Product X from Supplier Y at RM8/unit") → `PurchaseInvoice` drafted with lines → approval (`domain = purchase`, same `ApprovalTask` engine as every other module) → on approval, posts `StockMovement(purchase_receipt)` per line (Section 7) and recalculates `Product.default_cost` via weighted average (Vol 6_5 §4) when `Product.cost_source = auto_from_purchase` (Section 5) → posts Accounts Payable + the relevant expense/COGS account (Section 8's Chart of Accounts) via the existing Purchase posting rule (Vol 6_2, unchanged).

This stub deliberately does not cover: Purchase Orders (pre-receipt commitment tracking), supplier-specific price lists (the inverse of Section 5's customer-side `PriceListEntry`), or a Purchase equivalent of Section 4's AR ageing (Accounts Payable ageing) — all reasonable future extensions, out of scope for what Section 5/7 need today.

## 5. Module B — Harga & Kos Jualan (Pricing & Cost of Sales)

```text
PriceType
├── id                    string
├── business_id            string
├── name                    string — e.g. "Retail", "Stokis", "Ejen", "Dropship"
└── is_default              boolean

Product
├── id                     string
├── business_id             string
├── sku                      string, nullable
├── name                     string
├── unit_of_measure          string — "pcs", "kg", "box", etc.
├── default_cost             decimal, nullable — manual entry (owner's stated option)
├── cost_source               enum: manual | auto_from_purchase — Section 8 auto-calc
├── track_inventory            boolean — false for pure-service line items
└── status                    enum: active | inactive

PriceListEntry
├── id                      string
├── product_id               string, foreign key → Product
├── price_type_id             string, foreign key → PriceType
├── unit_price                decimal
├── effective_from             date
├── effective_to               date, nullable
└── promo_note                 string, nullable — "CNY promo", etc.
```

**Governed rule, sourced from Finance PKA (extends Vol 6_1 §4):** "which price a given customer sees" resolves as `Party.price_type_id → PriceListEntry` at quotation/invoice draft time, falling back to the business's default `PriceType` if the customer has none set — this resolution order is the kind of business-configurable-but-governed rule this project already keeps out of inline app logic (Vol 3_0), so it belongs in Finance PKA as rule `PRICE-001`, not hardcoded in the capture pipeline.

**Cost of Goods Sold:** `Product.default_cost` (manual) is Phase-appropriate to ship first; "auto-kira melalui invois belian" (auto-calculate via purchase invoice) requires Module D's Purchase-side documents to exist first (a `PurchaseInvoice` mirroring Section 4's shape, triggering `Product.default_cost` recalculation on receipt — weighted-average per Vol 6_5 §4's already-named costing method) — sequenced in Section 13 as a dependency, not designed twice here.

## 6. Module C — Perbelanjaan & Untung Rugi (Expense & Profit/Loss)

Vol 6_3 (Expense Operations) already covers ad-hoc receipt-photo expense capture well; this module adds the *formal, printable* side the owner named: **Payment Vouchers**.

```text
PaymentVoucher : DocumentHeader
├── status                 enum: draft | approved | paid
├── payee_party_id           string, foreign key → Party
├── expense_category          string — same category set Vol 6_3 BIE already assigns
├── document_id_receipt        string, nullable, foreign key → Document (Vol 11_1 §5) —
│                                                                the "kepilkan sekali dengan resit"
│                                                                requirement: PV and its receipt
│                                                                image are the same filing unit
└── payment_method              enum: cash | bank_transfer | cheque
```

A PV *is* an Expense Business Event (Vol 6_3) wrapped in the Section 3.2 document shape purely so it can be printed/exported as a numbered, approvable, receipt-attached voucher — it posts to the ledger exactly as an Expense does today, through the same `ApprovalTask` gate (Section 3.3) rather than a second bookkeeping path.

**Profit & Loss — no new schema, a read model over Section 3.4's chart of accounts (extended in Section 8 below).** The owner's "penyata untung rugi akan dijana secara automatik" is already the Financial Intelligence Engine's job per Vol 2_3/4_1 — what's missing today is enough chart-of-accounts granularity (Vol 11_1 §4.1's 7-bucket Phase 1 set) to show "cost/expense percentage breakdown by category" meaningfully; Section 8 below proposes the expanded chart.

## 7. Module D — Penghantaran & Inventori (Delivery & Inventory) — extends Vol 6_5

```text
Warehouse
├── id                     string
├── business_id              string
└── name                     string — single default warehouse is fine for most SMEs; the
                                       table exists so multi-location isn't a later rewrite

StockLevel
├── product_id               string, foreign key → Product
├── warehouse_id               string, foreign key → Warehouse
├── quantity_on_hand             decimal
└── last_movement_at             timestamp

StockMovement
├── id                        string
├── product_id                  string
├── warehouse_id                  string
├── movement_type                 enum: opening | purchase_receipt | delivery_out |
│                                      adjustment_increase | adjustment_decrease
├── quantity                       decimal — always positive; movement_type carries direction
├── unit_cost                       decimal, nullable — for valuation (weighted average, Vol 6_5 §4)
├── source_document_type              enum: delivery_order | purchase_invoice | stock_take | manual
├── source_document_id                 string, nullable
└── occurred_at                          timestamp

DeliveryOrder : DocumentHeader
├── status                    enum: draft | dispatched | delivered
├── invoice_id                  string, foreign key → Invoice
└── warehouse_id                 string, foreign key → Warehouse

StockTake
├── id                         string
├── warehouse_id                  string
├── status                         enum: in_progress | completed
├── counted_at                      timestamp
└── (lines: product_id, system_qty, counted_qty, variance → each variance line generates
    one StockMovement adjustment_increase/decrease on completion — "stock adjustment melalui
    stock take" is this generation step, not a separately-typed record)

ProductImportBatch
├── id                          string
├── source_file_ref               string — the uploaded Excel, kept for audit
├── status                          enum: parsed | applied | failed
└── row_count / error_count          integers — "import senarai produk ke dalam sistem dengan
                                                  Excel" needs a staging+validate step before
                                                  committing rows, same failure-handling
                                                  discipline Vol 0_1 §7 already applies to
                                                  OCR capture (never silently guess a bad row)
```

**Domain flow (extends Vol 6_5 §3):** `DeliveryOrder.status → dispatched` is the trigger point Vol 6_5 §3 already names ("Stock Sold ... typically triggered by a sale") — it posts a `StockMovement(delivery_out)` per line and decrements `StockLevel`, which is exactly "inventori akan ditolak secara automatik apabila Delivery Order dihantar."

## 8. Module E — Laporan Akaun (Accounting Reports)

This module is mostly a **reporting layer**, not new transactional tables — it closes the gap between Vol 4_1's already-defined components (Journal, Ledger, Trial Balance, Statements) and Vol 11_1 §4.1's Phase 1 chart, which is too small (7 buckets) to produce a real Trial Balance, Balance Sheet, or General Ledger export. Two real additions:

```text
ChartOfAccounts   (replaces Vol 11_1 §4.1's fixed subset with a real, still-small SME chart)
├── id                     string
├── business_id              string
├── account_code              string — e.g. "1000", "1100", "4000"
├── account_name               string
├── account_type                enum: asset | liability | equity | revenue | expense
├── parent_account_id             string, nullable — for subtotal rollups (Trial Balance groups)
└── is_system                       boolean — a small protected set (Cash, AR, AP, Retained
                                                Earnings) the owner cannot delete, matching how
                                                Vol 11_1 §4.1's set was already non-negotiable

BankAccount
├── id                       string
├── business_id                string
├── account_name                 string
├── ledger_account_id              string, foreign key → ChartOfAccounts (the Cash/Bank bucket
│                                                          this specific bank account maps to)
└── opening_balance                 decimal

BankStatementLine   (for reconciliation — "Kemaskini akaun melalui ... Bank Reconciliation")
├── id                        string
├── bank_account_id              string
├── statement_date                 date
├── description                     string
├── amount                           decimal
├── matched_ledger_entry_id           string, nullable, foreign key → LedgerEntry
└── match_status                       enum: unmatched | matched | ignored
```

`LedgerEntry.account` (Vol 11_1 §4) changes from a free string against a hardcoded 7-value enum to a foreign key against `ChartOfAccounts.id` — additive in spirit (every existing Phase 1 account maps 1:1 to a seeded `ChartOfAccounts` row, `is_system = true`) but is the one schema change in this volume that touches an *existing* table rather than only adding new ones, so it is called out explicitly rather than left implicit.

**Reports, all read-only over the above:** Cash Book (bank-account-filtered ledger view), General Ledger (per-account ledger view), Trial Balance (`sum(debit) - sum(credit)` grouped by account, the Vol 4_1 §3 component finally made concrete), Profit & Loss and Balance Sheet (standard groupings by `account_type`), AR/AP Ageing (real buckets now that `Invoice.due_date` exists per Module A, closing the exact gap Vol 6_1 §6 flagged), Stock report (from Section 7's `StockLevel`), Tax report (Section 9). None of these need their own storage; they need the `ChartOfAccounts` foreign key above and export formatting (PDF/Excel), which is UI/export work, not schema.

## 9. Module F — e-Invois & SST (LHDN & Kastam Compliance)

This is the highest external-dependency, highest-compliance-risk module in this volume — Vol 6_9 (Tax Operations) already flags Phase 2 informational-only and an explicit "not a substitute for a licensed tax professional" boundary (Vol 6_9 §5); that boundary carries forward unchanged here, now with an actual submission pipeline behind it.

```text
EInvoiceSubmission
├── id                       string
├── invoice_id                  string, foreign key → Invoice (or a synthetic consolidated one)
├── lhdn_uuid                     string, nullable — issued by MyInvois once validated
├── qr_code_ref                    string, nullable — pointer to generated QR image, per
│                                                       "pelanggan boleh dapatkan e-Invoice ...
│                                                       melalui QR code"
├── submission_type                 enum: normal | consolidated
├── consolidated_period               string, nullable — e.g. "2026-09" for a monthly batch
├── status                             enum: draft | submitted | validated | rejected | cancelled
├── irb_response_ref                     string, nullable — raw response, kept for audit
└── submitted_at                           timestamp, nullable

SstTransaction
├── id                        string
├── invoice_id or pv_id           string — SST applies on both the sales and certain service sides
├── sst_code                        string — e.g. "S1" (Sales Tax), "SV" (Service Tax), rate %
└── sst_amount                        decimal

SstReturn
├── id                        string
├── period                      string — SST is typically bimonthly in Malaysia
├── status                        enum: draft | submitted
├── total_output_tax                 decimal
└── submitted_at                       timestamp, nullable
```

**Governed rules (extends Vol 6_9 §4):** LHDN e-Invoice validation rules and SST rates/codes are exactly the kind of "jurisdiction-specific, versioned Knowledge Object" Vol 6_9 §4 already describes — they belong in Finance PKA as `regulations/MY-EINVOICE-RULES-<version>.json` and `regulations/MY-SST-RATES-<version>.json`, not inline in app code, for the same reason Vol 3_0 gives for every other jurisdictional rule: rates and validation schemas change on the regulator's schedule, not the app's release schedule.

**"Consolidated invoice with one click"** = one `EInvoiceSubmission(submission_type=consolidated)` row generated from all of a period's non-B2B e-Invoice-eligible invoices, per LHDN's own consolidated-invoice provision — this is a batch job over existing `Invoice` rows, not new invoice storage.

**Honest open dependency:** none of this works without registering for and integrating LHDN's MyInvois API (sandbox first, then production credentials) and a validated SST registration — this is an external account/compliance dependency the owner needs to hold, not something AiFA can bootstrap on its own; flagged again in Section 14.

## 10. Module G — Payroll & Penggajian (extends Vol 6_7)

```text
EmployeeProfile   (linked 1:1 to a Party with party_types ⊇ {employee})
├── party_id                  string, foreign key → Party
├── ic_number                    string — encrypted at rest (Vol 8_2)
├── epf_number                     string, nullable
├── socso_number                    string, nullable
├── income_tax_no (PCB)               string, nullable
├── bank_name / bank_account_no        string — for bulk payment file (below)
├── basic_salary                        decimal
├── employment_type                      enum: full_time | part_time | contract
└── hire_date / resign_date                date / date, nullable

PayrollRun
├── id                        string
├── period                       string — "2026-09"
├── status                         enum: draft | pending_approval | approved | paid
└── total_net_pay                    decimal

Payslip
├── id                        string
├── payroll_run_id                string, foreign key → PayrollRun
├── employee_party_id                string, foreign key → Party
├── gross_pay                          decimal
├── epf_employee / epf_employer          decimal / decimal
├── socso_employee / socso_employer        decimal / decimal
├── eis_employee / eis_employer              decimal / decimal
├── pcb_deduction                              decimal
├── claims_included                              decimal — Section 10.2
├── advance_deducted                              decimal — Section 10.2
├── net_pay                                        decimal
├── e_payslip_sent_at                               timestamp, nullable
└── e_payslip_channel                                enum: whatsapp | email

StatutoryRateTable   (Finance PKA-governed, versioned — not owner-editable in-app)
├── scheme                    enum: epf | socso | eis | pcb
├── version                      string — e.g. "MY-EPF-2026"
├── effective_from                 date
└── rate_rules                       structured rule set (bracket/percentage table per scheme)

Claim
├── id                        string
├── employee_party_id            string
├── amount                          decimal
├── category                          string — e.g. "travel", "medical"
├── status                              enum: pending_approval | approved | included_in_payroll
└── document_id_receipt                  string, nullable, foreign key → Document

SalaryAdvance
├── id                        string
├── employee_party_id            string
├── amount                          decimal
├── status                            enum: pending_approval | approved | fully_deducted
└── outstanding_balance                 decimal

BulkPaymentFileExport
├── id                        string
├── payroll_run_id               string
├── bank_format                    string — e.g. "Maybank2u", "CIMB BizChannel" (each Malaysian
│                                            bank has its own file spec — an Open Item, Section 14)
└── file_ref                          string
```

**Domain flow (extends Vol 6_7 §3):** owner initiates a `PayrollRun` → AI drafts each `Payslip` from `EmployeeProfile.basic_salary` + `StatutoryRateTable` (current version) + any approved `Claim`/`SalaryAdvance` for the period → `ApprovalTask(subject_type=payroll_run)` — payroll is exactly the kind of task Vol 8_1/8_2's stricter sensitivity classification (Vol 6_7 §5, already stated) means this should *never* land in the ≥90% auto-approve band regardless of confidence score; every payroll run requires an explicit owner tap, full stop — this is a deliberate departure from Section 3.3's general auto-approval allowance, stated here as a rule, not left to a confidence number → on approval, `BulkPaymentFileExport` generated + `Payslip.e_payslip_sent_at` set once WhatsApp/email delivery confirms → payroll expense + statutory liability posted to ledger (Vol 6_7 §3, unchanged) → "hubung terus kos gaji ke modul Laporan Akaun" is simply this posting landing in the same `ChartOfAccounts` (Section 8) every other module posts to — no separate integration needed once Section 8 exists.

## 11. Module H — Pengurusan Syarikat Lengkap (Attendance, Leave, Commission) — new domain

No existing Series 6 volume covers this; it sits alongside Payroll (Vol 6_7) as a peer domain rather than inside it, because attendance/leave have their own approval lifecycle independent of any payroll run.

```text
AttendanceRecord
├── id                        string
├── employee_party_id            string
├── clock_type                     enum: in | out
├── recorded_at                      timestamp
├── gps_lat / gps_lng                  decimal / decimal — "berasaskan lokasi GPS"
├── gps_accuracy_m                       decimal, nullable
└── source                                enum: mobile_app | manual_admin_entry

OvertimeRecord   (derived, not raw-captured — computed from AttendanceRecord pairs against
                  the employee's scheduled hours, then confirmed, same draft→approve shape)
├── id                        string
├── employee_party_id            string
├── date                            date
├── hours                              decimal
└── status                              enum: draft | approved | synced_to_payroll

LeaveType
├── id                        string
├── name                          string — "Annual", "Medical", "Unpaid", etc.
└── default_entitlement_days         decimal

LeaveBalance
├── employee_party_id            string
├── leave_type_id                    string
├── year                                integer
├── entitled_days                        decimal
└── used_days                              decimal

LeaveApplication
├── id                         string
├── employee_party_id             string
├── leave_type_id                    string
├── start_date / end_date              date / date
├── status                               enum: pending_approval | approved | rejected
├── approved_by                            string, nullable
└── (approval routed through ApprovalTask, Section 3.3 — "kelulusan pantas ... melalui sistem")

CommissionRule
├── id                        string
├── applies_to_party_id           string, nullable — null = business-wide default
├── basis                            enum: percent_of_invoice | percent_of_margin | flat_per_unit
├── rate                                decimal
└── product_scope                        string, nullable — restrict to a product/category

CommissionCalculation
├── id                        string
├── invoice_id                    string, foreign key → Invoice
├── agent_party_id                    string, foreign key → Party (party_types ⊇ {agent})
├── commission_rule_id                    string
├── amount                                  decimal
└── status                                    enum: computed | approved | paid
```

**Domain flow:** GPS clock-in/out (mobile capture, offline-queued per Vol 7_4's existing offline-capture pattern — no new offline model needed, this reuses it) → nightly/on-demand job derives `OvertimeRecord` drafts from the day's pairs vs. the employee's schedule → owner or manager approves → `synced_to_payroll` feeds directly into the next `PayrollRun`'s gross-pay calculation ("disinkronisikan terus ke sistem payroll"). `LeaveApplication` approval and `CommissionCalculation` (auto-triggered the moment an `Invoice.status` reaches `paid` or `issued`, per business configuration — "ditarik secara automatik daripada invois jualan yang berjaya") both route through the same `ApprovalTask` table every other module uses.

**Dashboard ("papan pemuka ... prestasi jualan berbanding kos pekerja"):** a read model joining Section 8's revenue reporting against this module's payroll+commission cost — no new storage, an Open Item for which specific ratios matter most (Section 14).

## 12. Module I — Legal & Commercial — new domain

```text
Contract
├── id                        string
├── business_id                  string
├── counterparty_id                  string, foreign key → Party
├── contract_type                       enum: distributor_agreement | nda | employment_contract | other
├── status                                 enum: draft | pending_signature | active | expired | terminated
├── start_date / end_date                    date / date, nullable
├── auto_renew                                  boolean
├── renewal_notice_days                           integer — drives the alert in Section 12.1
├── document_id                                     string, foreign key → Document (the actual file)
└── credit_limit_override                             decimal, nullable — a contract can carry
                                                                            its own credit term,
                                                                            overriding Party's default

ContractAlert
├── id                        string
├── contract_id                  string
├── alert_type                      enum: renewal_upcoming | expiring | expired
├── trigger_date                       date — computed from end_date - renewal_notice_days
├── status                                enum: pending | acknowledged
└── notified_at                              timestamp, nullable

ESignatureEnvelope
├── id                        string
├── contract_id (or quotation_id)   string — "pelanggan menandatangani Quotation atau Kontrak"
├── provider                            string — e.g. a third-party e-signature API (Open Item,
│                                                 Section 14 — AiFA should not build its own
│                                                 signature-legality infrastructure)
├── status                                 enum: sent | viewed | signed | declined | expired
└── signed_document_id                        string, nullable, foreign key → Document
```

### 12.1 Credit limit enforcement — the one module with a hard system-level gate

"Auto-sekat penghasilan Invois baru jika pelanggan telah melanggar terma had kredit" is the one feature in the owner's whole list that is a **blocking rule**, not an AI draft awaiting approval — it belongs as a guard evaluated at Module A's Invoice-creation step: `Party.credit_limit` (or `Contract.credit_limit_override` if one exists) compared against that customer's current `outstanding_balance` sum across unpaid Invoices; over-limit blocks new Invoice creation with a clear reason shown to the owner, with an explicit owner override path (never a silent, unexplained block) — consistent with this project's standing principle (Vol 1_4) that AI/system decisions are always explained, never opaque.

## 13. Phasing Recommendation

Vol 0_1's existing phase map already schedules Inventory (Phase 2), Asset (Phase 2), Payroll (Phase 2), Tax (Phase 2, informational-only) and treats Sales/Purchase/Expense/Banking as Phase 1 launch domains that, per Section 1 above, still need real building out. This volume proposes sequencing the nine requested modules as **four sub-phases inside Phase 2**, ordered by (a) dependency and (b) how directly each removes a stated manual pain point vs. how much external/compliance risk it carries:

| Sub-phase | Modules | Rationale |
|---|---|---|
| **2a** | Module A (Invoice/Quotation), Module B (Pricing), Module C (Expense/PV), Module E (Cash Book, P&L, real AR ageing) | Closes the most-repeated pain point ("stop doing this in Word/Excel manually") with the least external dependency. Builds `Party`, document numbering, and `ApprovalTask` — every later module needs these. |
| **2b** | Module D (Inventory/Delivery Order), rest of Module E (Balance Sheet, Trial Balance, GL, Bank Reconciliation) | Depends on Module A/B's `Product`/`Invoice`. Matches Vol 0_1's existing Phase 2 placement for Inventory. |
| **2c** | Module F (e-Invoice & SST) | Highest external dependency (LHDN MyInvois registration + API, SST registration) — sequenced after Sales/Inventory exist to submit against, and deliberately after, not blocking, 2a/2b so the owner gets value before compliance integration risk. |
| **2d** | Module G (Payroll), Module H (Attendance/Leave/Commission), Module I (Legal & Commercial) | Highest sensitivity (Module G, per Vol 6_7 §5) and lowest interdependency with the sales/accounting core — safest to build last, and Module H explicitly depends on Module G existing first. |

This is a proposal for the owner to accept, reorder, or reject — not a commitment. Per standing project rule, no sub-phase begins without its own explicit go-ahead, the same way Phase 2 (Web & Sync)'s Sprint 13 opened with a design sign-off checkpoint before any schema work shipped.

## 14. Open Items (must be resolved before build, not silently assumed)

1. **Single-user model conflict — RESOLVED.** Was: Vol 8_1 states Phase 1/2 is single-user-per-business, and several modules above assume distinct actors. This is now resolved by Series 13 existing at all — Vol 13_1 (Multi-Role Tenant & Delegated Approval), Vol 13_2 (Role-Gated Capture & Segregation of Duties), and Vol 13_3 (Growth-Adaptive Access Model) are the direct answer, and Phase 3's sprint plan (Sub-phase 3a, Sprints 21-25) builds them as the prerequisite foundation before any module in this volume ships.
2. **WhatsApp send mechanism (Section 4.1) — RESOLVED at Sprint 21 sign-off.** Click-to-chat, recorded in Section 4.1 directly.
3. **LHDN MyInvois and SST registration** (Section 9) are external, owner-held compliance dependencies AiFA cannot bootstrap. **Status at Sprint 21:** not yet started; owner will begin sandbox registration in parallel with Sub-phases 3a/3b so it is ready ahead of Sprint 33.
4. **Malaysian bank bulk-payment file formats (Section 10) — RESOLVED at Sprint 21 sign-off.** First target format: **Maybank2u**. Additional bank formats remain explicit follow-on work beyond Sprint 34.
5. **e-Signature provider (Section 12) — deferred, explicitly, at Sprint 21 sign-off.** Owner chose to revisit vendor selection closer to Sprint 36 rather than lock in now, given the ~7-month lead time on this plan before that sprint starts. Sprint 36's own Dependencies section carries this forward.
6. **Confidence-band tuning per module** (Section 3.3) — this volume states the one hard rule (payroll never auto-approves) but leaves every other module's auto-approve threshold as a tuning decision for real usage data, matching how Vol 0_1 §5 already treats its own thresholds as a starting configuration, not a final model. Still open.
7. **`ChartOfAccounts` migration** (Section 8) is the one change to an existing table in this whole volume — deserves its own small design/data-migration review before Section 13's sub-phase 2a starts, separate from the rest of this study. **Acknowledged at Sprint 21 sign-off** as its own reviewed step; Phase 3 Sprint 26 is that step.
8. **Purchase Operations gap — RESOLVED at Sprint 21 sign-off.** Section 4a added as a stub, sufficient for Section 5/7's dependencies; a fuller Purchase module design remains a future extension.

## 14a. Sprint 21 Design Sign-Off Record (2 September 2026)

Recorded per `docs/sprint-plan/Phase_3_Accounting_Compliance_Operations/Sprint_21_Design_SignOff_And_Series13_Scope_Confirmation.md`:

- Foundation-before-modules sequencing (Vol 13_1 §11.5) — confirmed.
- Sprint 22 as a design review, not a finished crypto spec (Vol 13_1 §11.1) — confirmed.
- Default SoD domains — accepted as proposed in Vol 13_2 §4.3, with owner-supplied thresholds: **expense/payment voucher RM 500**, **sales (quotation/invoice) RM 2,000** (matching the Approver/Supervisor role template's default limit). Recorded in full in Vol 13_2's own amendment (Section 4.3).
- WhatsApp mechanism: click-to-chat (Section 4.1).
- LHDN MyInvois sandbox: not yet started, owner beginning in parallel with Sub-phases 3a/3b.
- Bulk payment file format: Maybank2u (Section 10, Open Item 4).
- e-Signature provider: deferred to closer to Sprint 36 (Open Item 5).
- Purchase Operations gap: closed via Section 4a.

## 15. Relationships to Other Volumes

- Vol 6_1–6_9 remain the authoritative *domain* definitions this volume builds document/report/compliance structure on top of — this volume does not supersede them.
- Vol 4_0/4_1/11_1 remain the canonical Business Event → Business Data → Ledger pipeline; Section 2 states exactly how document-centred modules sit above it without changing its contract.
- Vol 3_0 (Finance PKA) gains new governed Knowledge Object categories: pricing resolution (`PRICE-001`), e-Invoice/SST rules, and statutory rate tables (EPF/SOCSO/EIS/PCB) — all versioned, none hardcoded, per existing Finance PKA discipline.
- Vol 8_1/8_2 (Identity, Security) are directly implicated by Open Item 1 and by Module G/H's employee data sensitivity, extending the "high-sensitivity" classification Vol 6_7 §5 already named for payroll to attendance/leave data.
- Vol 7_x (Mobile Application Architecture) needs new capture surfaces (GPS clock-in/out, stock take, quotation builder) — out of scope for this data/module-architecture volume, a follow-on UX design study.
- Vol 0_1 (MVP & Phased Delivery Roadmap) is the volume Section 13's phasing proposal would need to be merged into, once accepted.

---

## Appendix A — Owner's Original Feature List (verbatim, Bahasa Malaysia)

Preserved in full as the source-of-truth requirements this volume was derived from:

**Invois & Quotation** — Tak Perlu Lagi Buat Invois & Quotation Secara Manual Guna Word Bersesuaian Dengan Bisnes; Hantar quotation melalui WhatsApp; Rekod butir-butir pelanggan, barang yang dibeli; Rekod bayaran dan hutang pelanggan; Link dengan Delivery Order.

**Harga & Kos Jualan** — Tak perlu Lagi Buat Semakan Harga dan Kos Produk Secara Manual; Kemaskini senarai harga, promosi dengan mudah; Guna jenis harga yang berbeza seperti harga stokis, ejen, dropship; Invois akan guna jenis harga yang telah set untuk pelanggan tertentu; Masukkan kos produk secara manual atau auto-kira melalui invois belian.

**Perbelanjaan & Untung Rugi** — Tak perlu lagi tunggu akauntan untuk siapkan laporan untung rugi; Masukkan setiap perbelanjaan bisnes anda; Cetak payment voucher, kepilkan sekali dengan resit untuk buat filing; Penyata untung rugi akan dijana secara automatik tanpa kira secara manual; Lihat peratusan kos dan perbelanjaan yang paling tinggi.

**Penghantaran & Inventori** — Mudah untuk pantau dan kemaskini inventori setiap masa; Import senarai produk ke dalam sistem dengan Excel; Masukkan opening stok; Inventori akan ditolak secara automatik apabila Delivery Order dihantar; Buat stok adjustment melalui stock take.

**Laporan Akaun** — Kemaskini akaun untuk dapatkan laporan yang lengkap bagi audit dan cukai; Kemaskini akaun melalui Cash Book, Ledger dan Bank Reconciliation; Cetak dan export laporan akaun seperti Profit Loss, Balance Sheet, Trial Balance, General Ledger; Lihat juga laporan yang lain seperti Laporan Aging, Stok dan Cukai.

**e-Invois & SST** — Compliant dengan keperluan LHDN dan Kastam; Pelanggan boleh dapatkan e-Invoice dari sistem melalui QR code; Hantar consolidated invoice untuk semua jualan dengan satu klik sahaja; Pengiraan SST secara automatik dan hantar ke Kastam.

**Payroll & Penggajian** — Pengiraan automatik caruman wajib Malaysia termasuk KWSP, PERKESO, SIP dan PCB LHDN; Hantar e-payslip terus ke WhatsApp atau emel pekerja dengan satu klik; Jana fail bank pukal untuk pembayaran gaji pantas; Rekod tuntutan (claims) dan pendahuluan gaji (advance); Hubung terus kos gaji ke modul Laporan Akaun.

**Pengurusan Syarikat Lengkap** — Rekod kehadiran digital (Clock-In/Out) berasaskan lokasi GPS; Kiraan Overtime dan potongan cuti tanpa gaji disinkronisikan terus ke payroll; Sistem permohonan cuti digital dengan kelulusan pantas; Pengiraan komisen ejen/staf jualan automatik daripada invois jualan; Papan pemuka perniagaan untuk analisis prestasi jualan berbanding kos pekerja.

**Legal & Commercial** — Simpan dan urus dokumen kontrak digital (Distributor Agreement, NDA, Kontrak Pekerja); Notifikasi amaran awal sebelum tarikh tamat kontrak/renewal; e-Signature bersepadu; Pantau had kredit dan tempoh kredit pelanggan; Auto-sekat penghasilan Invois baru jika pelanggan melanggar had kredit.

---

*End of Volume 13_0.*
