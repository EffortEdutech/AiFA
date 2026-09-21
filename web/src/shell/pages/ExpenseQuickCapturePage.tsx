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
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePaymentVouchersReportsTransport } from "@aifa/core/sync/paymentVouchersReportsTransport";
import type { PaymentVoucherPaymentMethod } from "@aifa/core/sync/paymentVouchersReportsTransport";
import type { Party, ChartOfAccount } from "@aifa/core/sync/partyAndLedgerTransport";

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

  if (loadError) {
    return (
      <div className="aifa-page">
        <h1>Expense</h1>
        <p className="error">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="aifa-page">
      <h1>Expense</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Quick capture — creates a Payment Voucher the same as the full form on the Payment Vouchers page.{" "}
        {onGoToPaymentVouchers ? (
          <button onClick={onGoToPaymentVouchers} style={{ padding: "0 4px" }}>
            View all / mark paid
          </button>
        ) : (
          "See the Payment Vouchers sidebar item for the full list and Mark Paid."
        )}
      </p>

      <div className="card">
        <div className="row">
          <select value={payeePartyId} onChange={(e) => setPayeePartyId(e.target.value)} style={{ padding: 6, minWidth: 200 }}>
            <option value="">Select payee…</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
          <select value={expenseCategory} onChange={(e) => setExpenseCategory(e.target.value)} style={{ padding: 6, minWidth: 180 }}>
            <option value="">Category…</option>
            {expenseAccounts.map((a) => (
              <option key={a.id} value={a.accountName}>
                {a.accountName}
              </option>
            ))}
          </select>
        </div>
        {expenseAccounts.length === 0 && (
          <p className="muted" style={{ marginTop: 4 }}>
            No expense-type accounts found in your Chart of Accounts yet — add one there first.
          </p>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <input placeholder="Amount (RM)" value={grandTotal} onChange={(e) => setGrandTotal(e.target.value)} style={{ padding: 6, width: 140 }} />
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentVoucherPaymentMethod)} style={{ padding: 6 }}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ padding: 6, flex: 1 }} />
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button onClick={() => void handleCapture()} disabled={busy || !payeePartyId || !expenseCategory || !grandTotal.trim()}>
            {busy ? "Capturing…" : "Capture expense"}
          </button>
        </div>
        {justCreated && <p className="muted">Captured — routed to Approvals like any other Payment Voucher.</p>}
        {error && <p className="error">{error}</p>}
      </div>

      <h2 style={{ fontSize: 14, marginTop: 20 }}>Recently captured</h2>
      {recent.length === 0 ? (
        <p className="muted">Nothing captured yet.</p>
      ) : (
        recent.map((pv) => (
          <div key={pv.id} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>
                {pv.pvNo} — {partyName(pv.payeePartyId)}
              </strong>
              <span className="muted">{pv.status === "approved" ? "Approved — not yet paid" : pv.status}</span>
            </div>
            <p className="muted" style={{ margin: "4px 0" }}>
              {pv.currency} {pv.grandTotal.toFixed(2)} · {pv.expenseCategory}
            </p>
          </div>
        ))
      )}
    </div>
  );
}
