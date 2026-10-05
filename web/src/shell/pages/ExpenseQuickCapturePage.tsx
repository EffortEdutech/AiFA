/**
 * Expense (quick capture) — Sprint 41.
 *
 * DISCLOSED IA READING: Vol 12_2's sidebar reserves "Expense" as its own
 * item, separate from "Payment Vouchers" (sidebarConfig.ts, set in
 * Sprint 37) — but there is only one backend entity behind both,
 * `PaymentVoucher` (`expense_category` is a plain field on it, not a
 * separate table), and this sprint's own task breakdown groups "Payment
 * Vouchers & Expense" under a single transport/task line
 * (`paymentVouchersReportsTransport.ts`). Read as: "Payment Vouchers" is
 * the full list/lifecycle-management view (tabs, approve-linkage, mark
 * paid, receipt reference); "Expense" is a lean, capture-first entry
 * point into the exact same `createPaymentVoucher` call — mirroring the
 * Quick Capture / fuller-view split Sprint 37's OverviewPage already
 * established for the old local-first flow. Every voucher created here
 * is a real PaymentVoucher and shows up in the Payment Vouchers page's
 * own list immediately (same table, same RLS, same approval routing) --
 * this page adds no new data shape, only a faster form.
 *
 * UI polish Phase 4: presentation only — labelled fields, shared buttons
 * and a recent-captures table; the same createPaymentVoucher call.
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePaymentVouchersReportsTransport } from "@aifa/core/sync/paymentVouchersReportsTransport";
import type { PaymentVoucherPaymentMethod } from "@aifa/core/sync/paymentVouchersReportsTransport";
import type { Party, ChartOfAccount } from "@aifa/core/sync/partyAndLedgerTransport";

import { Button, Card, DataTable, Field, PageHeader, StatusPill, formatMoney, humanizeStatus, type Column } from "../../ui";
import { supabase } from "../../lib/supabaseClient";
import { listParties, listChartOfAccounts } from "../../lib/partiesAndAccounts";
import { listPaymentVouchers } from "../../lib/purchasesAndCash";
import type { PaymentVoucher } from "@aifa/core/sync/paymentVouchersReportsTransport";

const paymentVouchersReportsTransport = createSupabasePaymentVouchersReportsTransport(supabase);

const PAYMENT_METHODS: PaymentVoucherPaymentMethod[] = ["cash", "bank_transfer", "cheque"];

interface Props {
  businessId: string;
  /** Deep-link to the fuller Payment Vouchers page (e.g. to mark something paid, or review the full list) rather than duplicating that view here. */
  onGoToPaymentVouchers?: () => void;
}

export function ExpenseQuickCapturePage({ businessId, onGoToPaymentVouchers }: Props): JSX.Element {
  const [parties, setParties] = useState<Party[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<ChartOfAccount[]>([]);
  const [recent, setRecent] = useState<PaymentVoucher[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [payeePartyId, setPayeePartyId] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentVoucherPaymentMethod>("cash");
  const [grandTotal, setGrandTotal] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [p, accounts, vouchers] = await Promise.all([
        listParties(businessId),
        listChartOfAccounts(businessId),
        listPaymentVouchers(businessId),
      ]);
      setParties(p);
      setExpenseAccounts(accounts.filter((a) => a.accountType === "expense"));
      setRecent(vouchers.slice(0, 5));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load expense capture.");
    }
  }, [businessId]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  function partyName(id: string): string {
    return parties.find((p) => p.id === id)?.displayName ?? `Party #${id.slice(0, 8)}`;
  }

  async function handleCapture(): Promise<void> {
    if (!payeePartyId || !expenseCategory || !grandTotal.trim()) return;
    setBusy(true);
    setError(null);
    setJustCreated(false);
    try {
      await paymentVouchersReportsTransport.createPaymentVoucher({
        businessId,
        payeePartyId,
        expenseCategory,
        paymentMethod,
        grandTotal: Number(grandTotal),
        notes: notes.trim() || null,
      });
      setGrandTotal("");
      setNotes("");
      setJustCreated(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not capture this expense.");
    } finally {
      setBusy(false);
    }
  }

  const canCapture = Boolean(payeePartyId && expenseCategory && grandTotal.trim());

  const columns: Column<PaymentVoucher>[] = [
    {
      key: "pv",
      header: "Voucher",
      render: (pv) => (
        <>
          <strong>{pv.pvNo}</strong>
          <div className="ui-cell-sub">{partyName(pv.payeePartyId)}</div>
        </>
      ),
    },
    { key: "cat", header: "Category", render: (pv) => pv.expenseCategory },
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
      header: "Amount",
      numeric: true,
      render: (pv) => (pv.currency === "MYR" ? formatMoney(pv.grandTotal) : `${pv.currency} ${pv.grandTotal.toFixed(2)}`),
    },
  ];

  return (
    <div className="aifa-page">
      <PageHeader
        title="Expense"
        description="Quick capture — creates a Payment Voucher the same as the full form on the Payment Vouchers page."
        actions={
          onGoToPaymentVouchers ? (
            <Button variant="secondary" onClick={onGoToPaymentVouchers}>
              View all / mark paid
            </Button>
          ) : undefined
        }
      />
      {!onGoToPaymentVouchers && (
        <p className="ui-muted" style={{ marginTop: 0 }}>
          See the Payment Vouchers sidebar item for the full list and Mark Paid.
        </p>
      )}
      {loadError && (
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {loadError}
        </p>
      )}

      <Card title="Capture an expense">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && canCapture) void handleCapture();
          }}
        >
          <div className="ui-form-grid">
            <Field label="Payee" required>
              {(p) => (
                <select {...p} className="ui-select" value={payeePartyId} onChange={(e) => setPayeePartyId(e.target.value)}>
                  <option value="">Select payee…</option>
                  {parties.map((party) => (
                    <option key={party.id} value={party.id}>
                      {party.displayName}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field
              label="Category"
              required
              hint={expenseAccounts.length === 0 ? "No expense-type accounts found in your Chart of Accounts yet — add one there first." : undefined}
            >
              {(p) => (
                <select {...p} className="ui-select" value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)}>
                  <option value="">Category…</option>
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
          </div>
          <div style={{ marginTop: "var(--aifa-space-4)" }}>
            <Field label="Notes (optional)">
              {(p) => <input {...p} className="ui-input" value={notes} onChange={(e) => setNotes(e.target.value)} />}
            </Field>
          </div>
          <div className="ui-form-actions">
            <Button type="submit" variant="primary" loading={busy} disabled={!canCapture}>
              {busy ? "Capturing…" : "Capture expense"}
            </Button>
          </div>
          {justCreated && (
            <p className="aifa-alert aifa-alert--success" role="status">
              Captured — routed to Approvals like any other Payment Voucher.
            </p>
          )}
          {error && (
            <p className="aifa-alert aifa-alert--danger" role="alert">
              {error}
            </p>
          )}
        </form>
      </Card>

      <Card title="Recently captured" flush>
        <DataTable
          caption="Recently captured expenses"
          columns={columns}
          rows={loadError ? [] : recent}
          rowKey={(pv) => pv.id}
          empty={<div className="ui-table-state">Nothing captured yet.</div>}
        />
      </Card>
    </div>
  );
}
