/**
 * Business Overview → "Today" tab ("Money Moves") — 1 October 2026,
 * docs/ideas/AiFA_Improvement_Proposal_Money_Moves.md.
 *
 * Web (Path B) surface for the AI CFO Assistant Engine: a short, ranked
 * list of what the owner should do next, each with a plain-language
 * "why" and a button that jumps to the page that fixes it. Ranking lives
 * in `@aifa/core/ai/cfoActionFeed`; loading (shared with the mobile
 * Dashboard card) lives in `@aifa/core/ai/cfoActionFeedLoader`. This
 * component only wires web's read helpers in and renders the result.
 *
 * READS ONLY — no writes, no new RPC, no schema change.
 *
 * PARTIAL-DATA HONESTY: a source that fails to load (e.g. no permission
 * for this role) does not blank the list; it is named under the list,
 * so "nothing to do" is never claimed on missing data.
 *
 * DRAFT REMINDER (5 October 2026, slice 3): overdue-invoice moves get a
 * "Draft reminder" button that opens an editable WhatsApp message
 * (English or Bahasa Melayu, tone set by how late the invoice is — see
 * `@aifa/core/ai/paymentReminder`). "Open WhatsApp" opens a `wa.me`
 * click-to-chat link; the owner still taps Send inside WhatsApp —
 * AiFA never sends anything itself (same rule as the Quotation send
 * flow, owner's Sprint 21 choice).
 *
 * UI polish Phase 3: presentation only — shared card, buttons and fields;
 * ranking, loading, partial-data note and the WhatsApp rule are unchanged.
 */
import { useCallback, useEffect, useState } from "react";

import type { CfoAction, OverdueInvoiceRef } from "@aifa/core/ai/cfoActionFeed";
import { loadCfoActionFeed, type LoadedCfoActionFeed } from "@aifa/core/ai/cfoActionFeedLoader";
import {
  buildWhatsAppLink,
  draftPaymentReminder,
  normaliseMyPhoneE164,
  type ReminderLanguage,
} from "@aifa/core/ai/paymentReminder";
import { createSupabaseFullAccountingReportsTransport } from "@aifa/core/sync/fullAccountingReportsTransport";
import { createSupabaseLegalCommercialTransport } from "@aifa/core/sync/legalCommercialTransport";
import { createSupabasePaymentsCreditNotesTransport } from "@aifa/core/sync/paymentsCreditNotesTransport";

import { listApprovalTasks } from "../../lib/approvals";
import { listCaptureTriage } from "../../lib/captureTriage";
import { listParties } from "../../lib/partiesAndAccounts";
import { listPaymentVouchers } from "../../lib/purchasesAndCash";
import { supabase } from "../../lib/supabaseClient";
import { Button, Card, Field, SkeletonLines } from "../../ui";
import { SIDEBAR_ITEMS_BY_ID } from "../sidebarConfig";

const fullAccountingReportsTransport = createSupabaseFullAccountingReportsTransport(supabase);
const paymentsCreditNotesTransport = createSupabasePaymentsCreditNotesTransport(supabase);
const legalCommercialTransport = createSupabaseLegalCommercialTransport(supabase);

interface Props {
  businessId: string;
  /** Jump to a sidebar item (AppShell's setActiveItemId). Optional — without it, actions render without a button. */
  onNavigate?: (sidebarItemId: string) => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadForBusiness(businessId: string): Promise<LoadedCfoActionFeed> {
  return loadCfoActionFeed({
    cashBalance: async () => {
      const tb = await fullAccountingReportsTransport.trialBalance({ businessId, asOfDate: todayIso() });
      return tb.find((e) => e.accountCode === "1000")?.balance ?? null;
    },
    arAgeing: () => paymentsCreditNotesTransport.arAgeingDetail(businessId),
    paymentVouchers: () => listPaymentVouchers(businessId),
    approvalTasks: () => listApprovalTasks(businessId),
    dueContractAlerts: () => legalCommercialTransport.listDueContractAlerts(businessId),
    captureTriage: () => listCaptureTriage(businessId),
    parties: async () =>
      (await listParties(businessId)).map((p) => ({
        id: p.id,
        displayName: p.displayName,
        contactPhone: p.contactPhone,
      })),
  });
}

export function TodayMoneyMovesTab({ businessId, onNavigate }: Props): JSX.Element {
  const [loaded, setLoaded] = useState<LoadedCfoActionFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [openReminderId, setOpenReminderId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoaded(await loadForBusiness(businessId));
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loaded === null) {
    return (
      <Card title="Money Moves — what to do next" description="Working out today's money moves…">
        <SkeletonLines lines={3} />
      </Card>
    );
  }

  const { feed, failedSources, partyPhones } = loaded;

  return (
    <Card
      title="Money Moves — what to do next"
      actions={
        <Button size="sm" variant="secondary" icon="zap" loading={loading} onClick={() => void load()}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      }
    >
      {feed.actions.length === 0 ? (
        <p className="ui-muted" style={{ margin: 0 }}>
          {failedSources.length === 0
            ? "Nothing needs your attention right now."
            : "Nothing found in the data that loaded — see below for what could not be checked."}
        </p>
      ) : (
        <ol className="ui-move-list">
          {feed.actions.map((a) => (
            <MoneyMoveItem
              key={a.id}
              action={a}
              onNavigate={onNavigate}
              reminderOpen={openReminderId === a.id}
              onToggleReminder={() => setOpenReminderId((cur) => (cur === a.id ? null : a.id))}
              partyPhone={a.invoice ? (partyPhones[a.invoice.partyId] ?? null) : null}
            />
          ))}
        </ol>
      )}

      {feed.totalCandidates > feed.actions.length && (
        <p className="ui-note">
          Showing the top {feed.actions.length} of {feed.totalCandidates}.
        </p>
      )}
      {failedSources.length > 0 && (
        <p className="ui-note">
          Could not check: {failedSources.join(", ")} (no access for your role, or the read failed).
        </p>
      )}
    </Card>
  );
}

function MoneyMoveItem({
  action,
  onNavigate,
  reminderOpen,
  onToggleReminder,
  partyPhone,
}: {
  action: CfoAction;
  onNavigate?: (sidebarItemId: string) => void;
  reminderOpen: boolean;
  onToggleReminder: () => void;
  partyPhone: string | null;
}): JSX.Element {
  const target = SIDEBAR_ITEMS_BY_ID[action.targetPage];
  return (
    <li className="ui-move">
      <div className="ui-move__title">{action.title}</div>
      <div className="ui-move__why">Why: {action.why}</div>
      <div className="ui-inline-actions">
        {action.invoice && (
          <Button size="sm" variant="secondary" onClick={onToggleReminder} aria-expanded={reminderOpen}>
            {reminderOpen ? "Close reminder" : "Draft reminder"}
          </Button>
        )}
        {onNavigate && target && (
          <Button size="sm" variant="secondary" onClick={() => onNavigate(action.targetPage)}>
            Go to {target.label}
          </Button>
        )}
      </div>
      {reminderOpen && action.invoice && <ReminderPanel invoice={action.invoice} partyPhone={partyPhone} />}
    </li>
  );
}

function ReminderPanel({ invoice, partyPhone }: { invoice: OverdueInvoiceRef; partyPhone: string | null }): JSX.Element {
  const [language, setLanguage] = useState<ReminderLanguage>("en");
  const [text, setText] = useState(() => draftReminderFor(invoice, "en"));
  const [copied, setCopied] = useState(false);
  const phone = normaliseMyPhoneE164(partyPhone);

  function switchLanguage(next: ReminderLanguage): void {
    setLanguage(next);
    setText(draftReminderFor(invoice, next));
    setCopied(false);
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="ui-panel">
      <div className="ui-inline-actions" role="group" aria-label="Reminder language">
        <span className="ui-muted">Language:</span>
        <Button size="sm" variant="secondary" onClick={() => switchLanguage("en")} aria-pressed={language === "en"}>
          English
        </Button>
        <Button size="sm" variant="secondary" onClick={() => switchLanguage("ms")} aria-pressed={language === "ms"}>
          Bahasa Melayu
        </Button>
      </div>
      <div style={{ marginTop: "var(--aifa-space-3)" }}>
        <Field label="Message (edit before sending)">
          {(p) => (
            <textarea
              {...p}
              className="ui-textarea"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setCopied(false);
              }}
              rows={7}
            />
          )}
        </Field>
      </div>
      <div className="ui-inline-actions" style={{ marginTop: "var(--aifa-space-3)" }}>
        <Button
          size="sm"
          variant="primary"
          icon="send"
          onClick={() => window.open(buildWhatsAppLink(phone, text), "_blank", "noopener,noreferrer")}
        >
          Open WhatsApp
        </Button>
        <Button size="sm" variant="secondary" icon={copied ? "check" : undefined} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy text"}
        </Button>
      </div>
      <p className="ui-note">
        {phone
          ? `Opens a chat with ${invoice.partyName ?? "this customer"} (+${phone}). Nothing is sent until you tap Send in WhatsApp.`
          : "No valid phone number on file for this customer — WhatsApp will ask you to pick the contact. Nothing is sent until you tap Send."}
      </p>
    </div>
  );
}

function draftReminderFor(invoice: OverdueInvoiceRef, language: ReminderLanguage): string {
  return draftPaymentReminder(
    {
      customerName: invoice.partyName,
      invoiceNo: invoice.invoiceNo,
      outstandingBalance: invoice.outstandingBalance,
      dueDate: invoice.dueDate,
      daysOverdue: invoice.daysOverdue,
    },
    language,
  );
}
