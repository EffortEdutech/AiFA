/**
 * Payment Vouchers — Sprint 41 (Vol 13_0 §6 Module C, Vol 12_2 §5.2's
 * tabbed-lifecycle pattern reused from Sprint 40).
 *
 * TWO-POSTING-MOMENT NOTE (see paymentVouchersReportsTransport.ts's own
 * header): 'approved' is authorization only — no money has moved and no
 * ledger entry exists yet. `markPaymentVoucherPaid` is the ONLY action
 * that posts EXP-001 and is deliberately a separate, explicit button
 * from Approve, with its own distinct label, so this UI never implies
 * "approved" means "paid."
 *
 * RECEIPT ATTACHMENT SCOPE NOTE (disclosed, per this sprint's own Risks
 * table): `createDocument` only records an opaque storage reference —
 * it does not upload a file, and no Supabase Storage bucket convention
 * exists anywhere in web/ to build a real upload against (only the
 * mobile app's own encrypted-backup bucket exists, which is a different
 * purpose/path scheme). Rather than inventing a new storage pattern ad
 * hoc, this page accepts a plain text storage-reference field, clearly
 * labelled as a placeholder for wherever the file already lives — real
 * upload wiring is flagged as its own small follow-on task, exactly as
 * the sprint doc's own Risks table anticipated.
 *
 * UI polish Phase 4: presentation only — shared header, table with status
 * pills, labelled create form, Mark Paid in the row. Same calls and notes.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePaymentVouchersReportsTransport } from "@aifa/core/sync/paymentVouchersReportsTransport";
import type { PaymentVoucher, PaymentVoucherStatus, PaymentVoucherPaymentMethod } from "@aifa/core/sync/paymentVouchersReportsTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";
import type { ChartOfAccount } from "@aifa/core/sync/partyAndLedgerTransport";

import { Button, Card, DataTable, Field, PageHeader, StatusPill, formatDate, formatMoney, humanizeStatus, type Column } from "../../ui";
import { supabase } from "../../lib/supabaseClient";
import { listParties, listChartOfAccounts } from "../../lib/partiesAndAccounts";
import { listPaymentVouchers } from "../../lib/purchasesAndCash";
import { TabStrip } from "../TabStrip";

const paymentVouchersReportsTransport = createSupabasePaymentVouchersReportsTransport(supabase);

const PAYMENT_METHODS: PaymentVoucherPaymentMethod[] = ["cash", "bank_transfer", "cheque"];

type PvTab = "all" | PaymentVoucherStatus;

interface Props {
  businessId: string;
  onGoToApprovals?: () => void;
  /** Sprint 41 disclosed IA reading: Vol 12_2's sidebar reserves "Expense"
   * as a separate item from "Payment Vouchers," but there is only one
   * backend entity (PaymentVoucher — expense_category is just a field on
   * it, not a separate table), and this sprint's own task breakdown
   * groups "Payment Vouchers & Expense" under one transport/task line.
   * Read as: this page (full list/lifecycle) vs. a lean quick-capture
   * variant for the Expense item — see ExpenseQuickCapturePage.tsx.
   * `initialCreateOpen` lets that quick-capture page deep-link here
   * with the create form already open, rather than duplicating it. */
  initialCreateOpen?: boolean;
}

export function PaymentVouchersPage({ businessId, onGoToApprovals, initialCreateOpen }: Props): JSX.Element {
  const [vouchers, setVouchers] = useState<PaymentVoucher[] | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<ChartOfAccount[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<PvTab>("all");

  const [showCreate, setShowCreate] = useState(Boolean(initialCreateOpen));
  const [payeePartyId, setPayeePartyId] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentVoucherPaymentMethod>("cash");
  const [grandTotal, setGrandTotal] = useState("");
  const [notes, setNotes] = useState("");
  const [receiptStorageRef, setReceiptStorageRef] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [v, p, accounts] = await Promise.all([
        listPaymentVouchers(businessId),
        listParties(businessId),
        listChartOfAccounts(businessId),
      ]);
      setVouchers(v);
      setParties(p);
      setExpenseAccounts(accounts.filter((a) => a.accountType === "expense"));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load payment vouchers.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  function partyName(id: string): string {
    return parties.find((p) => p.id === id)?.displayName ?? `Party #${id.slice(0, 8)}`;
  }

  async function handleCreate(): Promise<void> {
    if (!payeePartyId || !expenseCategory || !grandTotal.trim()) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      let documentIdReceipt: string | null = null;
      if (receiptStorageRef.trim()) {
        const doc = await paymentVouchersReportsTransport.createDocument({
          businessId,
          storageRef: receiptStorageRef.trim(),
        });
        documentIdReceipt = doc.id;
      }
      await paymentVouchersReportsTransport.createPaymentVoucher({
        businessId,
        payeePartyId,
        expenseCategory,
        paymentMethod,
        grandTotal: Number(grandTotal),
        notes: notes.trim() || null,
        documentIdReceipt,
      });
      setPayeePartyId("");
      setExpenseCategory("");
      setGrandTotal("");
      setNotes("");
      setReceiptStorageRef("");
      setShowCreate(false);
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create payment voucher.");
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleMarkPaid(pv: PaymentVoucher): Promise<void> {
    setBusyId(pv.id);
    setActionError(null);
    try {
      await paymentVouchersReportsTransport.markPaymentVoucherPaid(pv.id);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not mark this voucher paid.");
    } finally {
      setBusyId(null);
    }
  }

  const filtered = (vouchers ?? []).filter((v) => tab === "all" || v.status === tab);
  const counts = (status: PaymentVoucherStatus) => (vouchers ?? []).filter((v) => v.status === status).length;

  const columns: Column<PaymentVoucher>[] = [
    {
      key: "pv",
      header: "Voucher",
      render: (pv) => (
        <>
          <strong>{pv.pvNo}</strong>
          <div className="ui-cell-sub">{partyName(pv.payeePartyId)}</div>
          {pv.notes && <div className="ui-cell-sub">{pv.notes}</div>}
        </>
      ),
    },
    { key: "cat", header: "Category", render: (pv) => pv.expenseCategory },
    { key: "method", header: "Method", render: (pv) => humanizeStatus(pv.paymentMethod) },
    { key: "issued", header: "Issued", render: (pv) => formatDate(pv.issueDate) },
    {
      key: "status",
      header: "Status",
      render: (pv) => (
        <StatusPill
          status={pv.status}
          label={pv.status === "approved" ? "Approved — not yet paid" : humanizeStatus(pv.status)}
        />
      ),
    },
    {
      key: "total",
      header: "Total",
      numeric: true,
      render: (pv) => (pv.currency === "MYR" ? formatMoney(pv.grandTotal) : `${pv.currency} ${pv.grandTotal.toFixed(2)}`),
    },
    {
      key: "actions",
      header: "",
      render: (pv) =>
        pv.status === "approved" ? (
          <Button size="sm" variant="primary" loading={busyId === pv.id} onClick={() => void handleMarkPaid(pv)}>
            {busyId === pv.id ? "Marking paid…" : "Mark Paid (money has actually left the business)"}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="aifa-page">
      <PageHeader
        title="Payment Vouchers"
        description="A new voucher routes through the Approvals inbox before it can be marked paid."
        actions={
          <>
            {onGoToApprovals && (
              <Button variant="secondary" onClick={onGoToApprovals}>
                Go to Approvals
              </Button>
            )}
            <Button variant="primary" icon={showCreate ? undefined : "plus"} onClick={() => setShowCreate((s) => !s)}>
              {showCreate ? "Cancel" : "New payment voucher"}
            </Button>
          </>
        }
      >
        <TabStrip
          tabs={[
            { id: "all", label: "All", count: vouchers?.length },
            { id: "draft", label: "Draft", count: counts("draft") },
            { id: "approved", label: "Approved (not yet paid)", count: counts("approved") },
            { id: "paid", label: "Paid", count: counts("paid") },
            { id: "rejected", label: "Rejected", count: counts("rejected") },
          ]}
          active={tab}
          onChange={setTab}
        />
      </PageHeader>
      {!onGoToApprovals && (
        <p className="ui-muted" style={{ marginTop: 0 }}>
          See the Approvals sidebar item.
        </p>
      )}

      {loadError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {loadError}
        </p>
      )}

      {showCreate && (
        <Card title="New payment voucher">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!createBusy && payeePartyId && expenseCategory && grandTotal.trim()) void handleCreate();
            }}
          >
            <div className="ui-form-grid">
              <Field label="Payee" required>
                {(p) => (
                  <select {...p} className="ui-select" value={payeePartyId} onChange={(e) => setPayeePartyId(e.target.value)}>
                    <option value="">Select payee…</option>
                    {parties.map((pt) => (
                      <option key={pt.id} value={pt.id}>
                        {pt.displayName}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field
                label="Expense category"
                required
                hint={expenseAccounts.length === 0 ? "No expense-type accounts found in your Chart of Accounts yet — add one there first." : undefined}
              >
                {(p) => (
                  <select {...p} className="ui-select" value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)}>
                    <option value="">Select expense category…</option>
                    {expenseAccounts.map((a) => (
                      <option key={a.id} value={a.accountName}>
                        {a.accountName}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Amount (RM)" required>
                {(p) => <input {...p} className="ui-input" inputMode="decimal" value={grandTotal} onChange={(e) => setGrandTotal(e.target.value)} />}
              </Field>
              <Field label="Payment method">
                {(p) => (
                  <select
                    {...p}
                    className="ui-select"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentVoucherPaymentMethod)}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Notes (optional)">
                {(p) => <input {...p} className="ui-input" value={notes} onChange={(e) => setNotes(e.target.value)} />}
              </Field>
              <Field
                label="Receipt storage reference (optional)"
                hint="File upload isn't wired yet — see this page's own header."
              >
                {(p) => <input {...p} className="ui-input" value={receiptStorageRef} onChange={(e) => setReceiptStorageRef(e.target.value)} />}
              </Field>
            </div>
            <div className="ui-form-actions">
              <Button type="submit" variant="primary" loading={createBusy} disabled={!payeePartyId || !expenseCategory || !grandTotal.trim()}>
                {createBusy ? "Creating…" : "Create voucher"}
              </Button>
            </div>
            {createError && (
              <p className="aifa-alert aifa-alert--danger" role="alert">
                {createError}
              </p>
            )}
          </form>
        </Card>
      )}

      {actionError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {actionError}
        </p>
      )}

      <Card flush>
        <DataTable
          caption="Payment vouchers"
          columns={columns}
          rows={loadError ? [] : vouchers === null ? null : filtered}
          rowKey={(pv) => pv.id}
          empty={<div className="ui-table-state">No payment vouchers in this view.</div>}
        />
      </Card>
    </div>
  );
}
