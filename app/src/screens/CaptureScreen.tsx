import {
  categoryOptionsForDomain,
  completePhotoCapture,
  runCaptureInterpretation,
  runExpensePhotoInterpretation,
} from "@aifa/core/ai/capturePipeline";
import type {
  BusinessDomain,
  VisionExtractedFields,
} from "@aifa/core/ai/types";
import { recordBankTransaction } from "@aifa/core/db/bankingRepository";
import {
  recordManualCapture,
  type BusinessDataType,
  type DomainHint,
} from "@aifa/core/db/businessEventRepository";
import {
  getOutstandingPayables,
  getOutstandingReceivables,
} from "@aifa/core/db/financialSummaryRepository";
import React, { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
} from "react-native";

import { getDefaultExpenseProvider } from "@/ai/client";
import { ActivityFeed } from "@/components/ActivityFeed";
import {
  BankTransactionForm,
  type BankTransactionFormValues,
} from "@/components/BankTransactionForm";
import {
  ManualCaptureForm,
  type ManualCaptureFormValues,
} from "@/components/ManualCaptureForm";
import { PhotoCapture } from "@/components/PhotoCapture";
import { getDb } from "@/db/client";
import { useRecentActivity } from "@/hooks/useRecentActivity";

/**
 * Business Event Capture — Vol 7_1. As of Sprint 3, Expense-domain text
 * captures go through the real AI interpretation pipeline
 * (ai/capturePipeline.ts). As of Sprint 5, photo capture (Vol 7_1 §2 photo
 * mode) does too, sharing the same classification/routing logic and
 * falling back to this same form (pre-filled where extraction partially
 * succeeded, blank where it failed entirely) per Vol 7_1 §5.1. As of
 * Sprint 6, Sale and Purchase text captures also go through the same AI
 * pipeline (domain-parameterised, Vol 6_0 §4). As of Sprint 7, Banking has
 * its own dedicated deterministic capture flow (BankTransactionForm +
 * bankingRepository.ts, Vol 6_4) — manual-entry, but not the generic
 * ManualCaptureForm path, since it needs reconciliation-matching UI the
 * other domains don't (see BankTransactionForm's own comment).
 *
 * This screen is a permanent tab in the bottom navigator (App Navigator,
 * Sprint 1), which already satisfies the "reachable in one tap from
 * anywhere" requirement (Vol 7_1 Section 4) — no extra work needed here.
 *
 * Activity fetch/resolve/correct logic lives in hooks/useRecentActivity.ts
 * (Sprint 4), shared with DashboardScreen's "Recent Business Events" panel.
 *
 * KNOWN GAP (Sprint 5): offline detection is not wired to a real network
 * check (no connectivity library installed — a new dependency, not added
 * without approval); photo capture always passes isOnline: true to the
 * pipeline. The 'queued_offline' code path exists and is unit-tested, it
 * just has no live UI trigger yet — Sprint 9 hardens this properly.
 */

/**
 * The `else` branch of isAiInterpretedDomain's guard narrows to this type
 * (Banking + Unclassified) — Banking is included here because the type
 * guard doesn't know ManualCaptureForm's chips no longer offer it (Sprint
 * 7); domainHintToDataType below throws defensively if it's ever actually
 * reached, since real Banking capture now goes through
 * BankTransactionForm/recordBankTransaction, not this manual/
 * immediate-confirm/no-ledger path.
 */
type ManualOnlyDomainHint = Exclude<
  DomainHint,
  "expense" | "sale" | "purchase"
>;

const AI_INTERPRETED_DOMAINS: BusinessDomain[] = [
  "expense",
  "sale",
  "purchase",
];

function isAiInterpretedDomain(hint: DomainHint): hint is BusinessDomain {
  return (AI_INTERPRETED_DOMAINS as DomainHint[]).includes(hint);
}

/**
 * Exhaustive mapping so a future DomainHint addition fails to compile here
 * instead of silently producing a wrong/undefined BusinessData.type. Only
 * used for the manual path now that expense/sale/purchase have their own
 * AI-interpreted flow.
 */
function domainHintToDataType(hint: ManualOnlyDomainHint): BusinessDataType {
  switch (hint) {
    case "banking":
      // Unreachable via the UI as of Sprint 7 — ManualCaptureForm's domain
      // chips no longer include Banking (see BankTransactionForm instead).
      // Kept as a defensive throw, not a silent fallback, in case this
      // path is ever reached some other way in the future.
      throw new Error(
        "Banking capture must go through BankTransactionForm/recordBankTransaction, not the manual capture path.",
      );
    case "unclassified":
      return "expense";
  }
}

type PhotoFallback = {
  eventId: string;
  photoBase64: string;
  prefill: VisionExtractedFields | null;
};

export default function CaptureScreen() {
  const {
    businessId,
    activity,
    loadError,
    refreshing,
    refresh,
    pullToRefresh,
    resolveDraftOrClarify,
    correctConfirmed,
  } = useRecentActivity();
  const [submitting, setSubmitting] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [showBanking, setShowBanking] = useState(false);
  const [photoFallback, setPhotoFallback] = useState<PhotoFallback | null>(
    null,
  );
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);

  async function handleSubmit(values: ManualCaptureFormValues) {
    if (!businessId) return;
    setSubmitting(true);
    try {
      const db = await getDb();
      if (isAiInterpretedDomain(values.domainHint)) {
        await runCaptureInterpretation(db, getDefaultExpenseProvider(), {
          domain: values.domainHint,
          businessId,
          description: values.description,
          counterpartyName: values.counterpartyName || undefined,
          amount: Number(values.amount),
          currency: values.currency || "MYR",
          paymentMethod: values.paymentMethod,
        });
      } else {
        await recordManualCapture(db, {
          businessId,
          domainHint: values.domainHint,
          dataType: domainHintToDataType(values.domainHint),
          description: values.description,
          counterpartyName: values.counterpartyName || undefined,
          amount: Number(values.amount),
          currency: values.currency || "MYR",
          paymentMethod: values.paymentMethod,
        });
      }
      await refresh(businessId);
    } finally {
      setSubmitting(false);
    }
  }

  async function loadReconciliationCandidates(type: "deposit" | "withdrawal") {
    const db = await getDb();
    if (!businessId) return [];
    return type === "deposit"
      ? getOutstandingReceivables(db, businessId)
      : getOutstandingPayables(db, businessId);
  }

  async function handleBankingSubmit(values: BankTransactionFormValues) {
    if (!businessId) return;
    setSubmitting(true);
    try {
      const db = await getDb();
      await recordBankTransaction(db, {
        businessId,
        transactionType: values.transactionType,
        description: values.description,
        amount: Number(values.amount),
        currency: values.currency || "MYR",
        matchBusinessDataId: values.matchBusinessDataId,
      });
      setShowBanking(false);
      await refresh(businessId);
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePhotoCaptured(base64: string, mimeType: string) {
    setShowCamera(false);
    if (!businessId) return;
    setSubmitting(true);
    setPhotoNotice(null);
    try {
      const db = await getDb();
      const outcome = await runExpensePhotoInterpretation(
        db,
        getDefaultExpenseProvider(),
        { businessId, base64Image: base64, mimeType, isOnline: true },
      );

      if (outcome.kind === "queued_offline") {
        setPhotoNotice(
          "No connection — saved and queued. It'll be interpreted once you're back online.",
        );
      } else if (outcome.kind === "needs_manual_entry") {
        setPhotoFallback({
          eventId: outcome.event.id,
          photoBase64: base64,
          prefill: outcome.prefill,
        });
      }
      await refresh(businessId);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFallbackSubmit(values: ManualCaptureFormValues) {
    if (!photoFallback) return;
    setSubmitting(true);
    try {
      const db = await getDb();
      await completePhotoCapture(db, getDefaultExpenseProvider(), {
        eventId: photoFallback.eventId,
        description: values.description,
        counterpartyName: values.counterpartyName || undefined,
        amount: Number(values.amount),
        currency: values.currency || "MYR",
        paymentMethod: values.paymentMethod,
      });
      setPhotoFallback(null);
      if (businessId) await refresh(businessId);
    } finally {
      setSubmitting(false);
    }
  }

  if (showCamera) {
    return (
      <PhotoCapture
        onCaptured={handlePhotoCaptured}
        onCancel={() => setShowCamera(false)}
      />
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={pullToRefresh} />
        }
      >
        <Text style={styles.heading}>Capture</Text>

        {loadError && <Text style={styles.error}>{loadError}</Text>}
        {photoNotice && <Text style={styles.notice}>{photoNotice}</Text>}

        {photoFallback ? (
          <>
            <Image
              source={{
                uri: `data:image/jpeg;base64,${photoFallback.photoBase64}`,
              }}
              style={styles.photoPreview}
            />
            <Text style={styles.sectionHeading}>Finish this receipt</Text>
            <ManualCaptureForm
              onSubmit={handleFallbackSubmit}
              submitting={submitting}
              prefill={photoFallback.prefill}
              lockDomainHint="expense"
            />
            <Pressable
              style={styles.cancelLink}
              onPress={() => setPhotoFallback(null)}
            >
              <Text style={styles.cancelLinkText}>Discard, capture again</Text>
            </Pressable>
          </>
        ) : showBanking ? (
          <>
            <Text style={styles.sectionHeading}>Log a bank transaction</Text>
            <BankTransactionForm
              onSubmit={handleBankingSubmit}
              submitting={submitting}
              loadCandidates={loadReconciliationCandidates}
            />
            <Pressable
              style={styles.cancelLink}
              onPress={() => setShowBanking(false)}
            >
              <Text style={styles.cancelLinkText}>Back to capture</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              style={styles.photoButton}
              onPress={() => setShowCamera(true)}
              accessibilityRole="button"
            >
              <Text style={styles.photoButtonText}>Take a photo</Text>
            </Pressable>

            <Pressable
              style={styles.bankingButton}
              onPress={() => setShowBanking(true)}
              accessibilityRole="button"
            >
              <Text style={styles.bankingButtonText}>
                Log a bank transaction
              </Text>
            </Pressable>

            <Text style={styles.orDivider}>or enter manually</Text>

            <ManualCaptureForm
              onSubmit={handleSubmit}
              submitting={submitting}
            />
          </>
        )}

        <Text style={styles.sectionHeading}>Recent activity</Text>
        <ActivityFeed
          items={activity}
          categoryOptionsForDomain={categoryOptionsForDomain}
          onResolve={resolveDraftOrClarify}
          onCorrectConfirmed={correctConfirmed}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 16, gap: 12 },
  heading: { fontSize: 24, fontWeight: "600" },
  sectionHeading: { fontSize: 16, fontWeight: "600", marginTop: 16 },
  error: { color: "#c0392b", fontSize: 13 },
  notice: { color: "#8a5a00", fontSize: 13 },
  photoButton: {
    backgroundColor: "#222",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  photoButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  bankingButton: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#222",
    paddingVertical: 14,
    alignItems: "center",
  },
  bankingButtonText: { color: "#222", fontSize: 16, fontWeight: "600" },
  orDivider: {
    textAlign: "center",
    fontSize: 12,
    color: "#767676",
    marginTop: 4,
  },
  photoPreview: {
    width: "100%",
    height: 220,
    borderRadius: 12,
    backgroundColor: "#eee",
  },
  cancelLink: { alignSelf: "center", marginTop: 4 },
  cancelLinkText: {
    fontSize: 13,
    color: "#555",
    textDecorationLine: "underline",
  },
});
