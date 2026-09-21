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
 */
import { useCallback, useEffect, useState } from "react";

import { createSupabasePaymentVouchersReportsTransport } from "@aifa/core/sync/paymentVouchersReportsTransport";
import type { PaymentVoucher, PaymentVoucherStatus, PaymentVoucherPaymentMethod } from "@aifa/core/sync/paymentVouchersReportsTransport";
import type { Party } from "@aifa/core/sync/partyAndLedgerTransport";
import type { ChartOfAccount } from "@aifa/core/sync/partyAndLedgerTransport";

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

  if (loadError) {
    return (
      <div className="aifa-page">
        <h1>Payment Vouchers</h1>
        <p className="error">{loadError}</p>
      </div>
    );
  }

  const filtered = (vouchers ?? []).filter((v) => tab === "all" || v.status === tab);
  const counts = (status: PaymentVoucherStatus) => (vouchers ?? []).filter((v) => v.status === status).length;

  return (
    <div className="aifa-page">
      <h1>Payment Vouchers</h1>
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

      <p className="muted" style={{ margin: "8px 0" }}>
        A new voucher routes through the Approvals inbox before it can be marked paid.{" "}
        {onGoToApprovals ? (
          <button onClick={onGoToApprovals} style={{ padding: "0 4px" }}>
            Go to Approvals
          </button>
        ) : (
          "See the Approvals sidebar item."
        )}
      </p>

      <div className="row" style={{ margin: "12px 0" }}>
        <button onClick={() => setShowCreate((s) => !s)}>{showCreate ? "Cancel" : "New payment voucher"}</button>
      </div>

      {showCreate && (
        <div className="card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>New payment voucher</h2>
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
              <option value="">Select expense category…</option>
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
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ padding: 6, flex: 1 }} />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              placeholder="Receipt storage reference (optional — file upload isn't wired yet, see this page's own header)"
              value={receiptStorageRef}
              onChange={(e) => setReceiptStorageRef(e.target.value)}
              style={{ padding: 6, flex: 1 }}
            />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button
              onClick={() => void handleCreate()}
              disabled={createBusy || !payeePartyId || !expenseCategory || !grandTotal.trim()}
            >
              {createBusy ? "Creating…" : "Create voucher"}
            </button>
          </div>
          {createError && <p className="error">{createError}</p>}
        </div>
      )}

      {actionError && <p className="error">{actionError}</p>}

      {vouchers === null ? (
        <p className="muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="muted">No payment vouchers in this view.</p>
      ) : (
        filtered.map((pv) => {
          const busy = busyId === pv.id;
          return (
            <div key={pv.id} className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>
                  {pv.pvNo} — {partyName(pv.payeePartyId)}
                </strong>
                <span
                  className="muted"
                  style={pv.status === "paid" ? { color: "#1b7a3d", fontWeight: 600 } : undefined}
                >
                  {pv.status === "approved" ? "Approved — not yet paid" : pv.status}
                </span>
              </div>
              <p className="muted" style={{ margin: "4px 0" }}>
                {pv.currency} {pv.grandTotal.toFixed(2)} · {pv.expenseCategory} · {pv.paymentMethod} · issued {pv.issueDate}
              </p>
              {pv.notes && <p style={{ margin: "4px 0" }}>{pv.notes}</p>}
              {pv.status === "approved" && (
                <div className="row" style={{ marginTop: 6 }}>
                  <button onClick={() => void handleMarkPaid(pv)} disabled={busy}>
                    {busy ? "Marking paid…" : "Mark Paid (money has actually left the business)"}
                  </button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
