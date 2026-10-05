/**
 * Mobile "Money Moves" card — top of the Dashboard (5 October 2026,
 * slice 4 of docs/ideas/AiFA_Improvement_Proposal_Money_Moves.md).
 *
 * Same feed as the web Business Overview → Today tab: both call the
 * shared `@aifa/core/ai/cfoActionFeedLoader`, so ranking, wording and
 * the partial-data rules are identical. Mobile differences:
 * - No "Go to page" buttons — those pages (AR Ageing, Approvals, …) only
 *   exist in the web app today; the card says so instead.
 * - Needs sign-in: the data lives in the cloud books (see
 *   lib/moneyMovesSources.ts). Signed out, the card explains how to turn
 *   it on and never blocks the rest of the local-first Dashboard.
 * - "Draft reminder" uses React Native's built-in `Linking` (open
 *   WhatsApp) and `Share` (copy/send elsewhere) — no new dependencies.
 *   Nothing is sent until the owner taps Send in WhatsApp.
 */
import type { CfoAction, OverdueInvoiceRef } from "@aifa/core/ai/cfoActionFeed";
import {
  loadCfoActionFeed,
  type LoadedCfoActionFeed,
} from "@aifa/core/ai/cfoActionFeedLoader";
import {
  buildWhatsAppLink,
  draftPaymentReminder,
  normaliseMyPhoneE164,
  type ReminderLanguage,
} from "@aifa/core/ai/paymentReminder";
import React, { useCallback, useEffect, useState } from "react";
import {
  Linking,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuthSession } from "@/lib/auth";
import {
  createMobileMoneyMovesSources,
  resolveMyBusiness,
} from "@/lib/moneyMovesSources";

type CardState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "noBusiness" }
  | { status: "manyBusinesses"; count: number }
  | { status: "error"; message: string }
  | { status: "ready"; loaded: LoadedCfoActionFeed };

interface Props {
  /** Bump to reload (Dashboard's pull-to-refresh). */
  refreshKey: number;
}

export function MoneyMovesCard({ refreshKey }: Props) {
  const { session, isLoading: authLoading } = useAuthSession();
  const userId = session?.user.id ?? null;
  const [state, setState] = useState<CardState>({ status: "loading" });
  const [openReminderId, setOpenReminderId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setState({ status: "signedOut" });
      return;
    }
    setState({ status: "loading" });
    try {
      const business = await resolveMyBusiness(userId);
      if (business.kind === "none") {
        setState({ status: "noBusiness" });
        return;
      }
      if (business.kind === "many") {
        setState({ status: "manyBusinesses", count: business.count });
        return;
      }
      const loaded = await loadCfoActionFeed(
        createMobileMoneyMovesSources(business.businessId),
      );
      setState({ status: "ready", loaded });
    } catch (err) {
      setState({
        status: "error",
        message:
          err instanceof Error ? err.message : "Could not load Money Moves.",
      });
    }
  }, [userId]);

  useEffect(() => {
    if (authLoading) return;
    load();
  }, [authLoading, load, refreshKey]);

  if (authLoading) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Money Moves — what to do next</Text>
      <CardBody
        state={state}
        openReminderId={openReminderId}
        onToggleReminder={(id) =>
          setOpenReminderId((cur) => (cur === id ? null : id))
        }
      />
    </View>
  );
}

function CardBody({
  state,
  openReminderId,
  onToggleReminder,
}: {
  state: CardState;
  openReminderId: string | null;
  onToggleReminder: (id: string) => void;
}) {
  switch (state.status) {
    case "loading":
      return <Text style={styles.muted}>Working out today's money moves…</Text>;
    case "signedOut":
      return (
        <Text style={styles.muted}>
          Sign in under Settings → Account to see what needs your attention
          across invoices, bills, approvals and contracts.
        </Text>
      );
    case "noBusiness":
      return (
        <Text style={styles.muted}>
          No business found for this account yet. Set one up in the AiFA web
          app.
        </Text>
      );
    case "manyBusinesses":
      return (
        <Text style={styles.muted}>
          This account belongs to {state.count} businesses. Choosing between
          them isn't on mobile yet — open the AiFA web app to see each one's
          Money Moves.
        </Text>
      );
    case "error":
      return <Text style={styles.error}>{state.message}</Text>;
    case "ready": {
      const { feed, failedSources, partyPhones } = state.loaded;
      return (
        <>
          {feed.actions.length === 0 ? (
            <Text style={styles.muted}>
              {failedSources.length === 0
                ? "Nothing needs your attention right now."
                : "Nothing found in the data that loaded — see below for what could not be checked."}
            </Text>
          ) : (
            feed.actions.map((a, i) => (
              <MoveRow
                key={a.id}
                index={i + 1}
                action={a}
                reminderOpen={openReminderId === a.id}
                onToggleReminder={() => onToggleReminder(a.id)}
                partyPhone={
                  a.invoice ? (partyPhones[a.invoice.partyId] ?? null) : null
                }
              />
            ))
          )}
          {feed.totalCandidates > feed.actions.length && (
            <Text style={styles.footnote}>
              Showing the top {feed.actions.length} of {feed.totalCandidates}.
            </Text>
          )}
          {failedSources.length > 0 && (
            <Text style={styles.footnote}>
              Could not check: {failedSources.join(", ")} (no access for your
              role, or the read failed).
            </Text>
          )}
          <Text style={styles.footnote}>
            To act on an item, open the matching page in the AiFA web app.
          </Text>
        </>
      );
    }
  }
}

function MoveRow({
  index,
  action,
  reminderOpen,
  onToggleReminder,
  partyPhone,
}: {
  index: number;
  action: CfoAction;
  reminderOpen: boolean;
  onToggleReminder: () => void;
  partyPhone: string | null;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>
        {index}. {action.title}
      </Text>
      <Text style={styles.why}>Why: {action.why}</Text>
      {action.invoice && (
        <Pressable
          onPress={onToggleReminder}
          accessibilityRole="button"
          accessibilityState={{ expanded: reminderOpen }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>
            {reminderOpen ? "Close reminder" : "Draft reminder"}
          </Text>
        </Pressable>
      )}
      {reminderOpen && action.invoice && (
        <ReminderPanel invoice={action.invoice} partyPhone={partyPhone} />
      )}
    </View>
  );
}

function ReminderPanel({
  invoice,
  partyPhone,
}: {
  invoice: OverdueInvoiceRef;
  partyPhone: string | null;
}) {
  const [language, setLanguage] = useState<ReminderLanguage>("en");
  const [text, setText] = useState(() => draftReminderFor(invoice, "en"));
  const [openError, setOpenError] = useState<string | null>(null);
  const phone = normaliseMyPhoneE164(partyPhone);

  function switchLanguage(next: ReminderLanguage) {
    setLanguage(next);
    setText(draftReminderFor(invoice, next));
  }

  async function openWhatsApp() {
    setOpenError(null);
    try {
      await Linking.openURL(buildWhatsAppLink(phone, text));
    } catch {
      setOpenError(
        "Could not open WhatsApp on this device. Use Share instead.",
      );
    }
  }

  return (
    <View style={styles.panel}>
      <View style={styles.inlineRow}>
        <LangButton
          label="English"
          active={language === "en"}
          onPress={() => switchLanguage("en")}
        />
        <LangButton
          label="Bahasa Melayu"
          active={language === "ms"}
          onPress={() => switchLanguage("ms")}
        />
      </View>
      <Text style={styles.footnote}>Message (edit before sending)</Text>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        style={styles.input}
        accessibilityLabel="Reminder message"
      />
      <View style={styles.inlineRow}>
        <Pressable
          onPress={openWhatsApp}
          accessibilityRole="button"
          style={styles.button}
        >
          <Text style={styles.buttonText}>Open WhatsApp</Text>
        </Pressable>
        <Pressable
          onPress={() => Share.share({ message: text })}
          accessibilityRole="button"
          style={styles.button}
        >
          <Text style={styles.buttonText}>Share</Text>
        </Pressable>
      </View>
      {openError && <Text style={styles.error}>{openError}</Text>}
      <Text style={styles.footnote}>
        {phone
          ? `Opens a chat with ${invoice.partyName ?? "this customer"} (+${phone}). Nothing is sent until you tap Send in WhatsApp.`
          : "No valid phone number on file for this customer — WhatsApp will ask you to pick the contact. Nothing is sent until you tap Send."}
      </Text>
    </View>
  );
}

function LangButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.button, active && styles.buttonActive]}
    >
      <Text style={[styles.buttonText, active && styles.buttonTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function draftReminderFor(
  invoice: OverdueInvoiceRef,
  language: ReminderLanguage,
): string {
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

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  label: { fontSize: 14, fontWeight: "600", color: "#111827", marginBottom: 8 },
  muted: { fontSize: 14, color: "#6b7280" },
  error: { fontSize: 13, color: "#b91c1c", marginTop: 4 },
  footnote: { fontSize: 12, color: "#6b7280", marginTop: 6 },
  row: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#f3f4f6" },
  title: { fontSize: 15, fontWeight: "600", color: "#111827" },
  why: { fontSize: 13, color: "#4b5563", marginTop: 2 },
  inlineRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  button: {
    alignSelf: "flex-start",
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
    minHeight: 36,
    justifyContent: "center",
  },
  buttonActive: { backgroundColor: "#111827", borderColor: "#111827" },
  buttonText: { fontSize: 14, color: "#111827" },
  buttonTextActive: { color: "#fff" },
  panel: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: "#f9fafb",
  },
  input: {
    minHeight: 140,
    marginTop: 4,
    padding: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    backgroundColor: "#fff",
    textAlignVertical: "top",
    fontSize: 14,
  },
});
