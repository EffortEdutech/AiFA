/**
 * Shared loader for the "Money Moves" feed (5 October 2026) — used by
 * BOTH the web Today tab and the mobile Dashboard card, so the two can
 * never disagree on what they show.
 *
 * Each platform supplies its own read functions (`CfoActionFeedSources`)
 * — web and mobile have different Supabase clients and helper modules —
 * and this module does the platform-independent part: run every read in
 * parallel, tolerate individual failures, build the feed.
 *
 * PARTIAL-DATA HONESTY: a read that fails (e.g. RLS denies a module to
 * this role) is recorded in `failedSources` by a plain-language label and
 * contributes nothing, rather than failing the whole feed or silently
 * pretending that area is fine.
 */
import {
  buildCfoActionFeed,
  type CfoActionFeed,
  type CfoActionFeedOptions,
} from "./cfoActionFeed";
import type { ApprovalTask } from "../sync/approvalEngineTransport";
import type { CaptureTriageItem } from "../sync/captureTriageTransport";
import type { ContractAlert } from "../sync/legalCommercialTransport";
import type { PaymentVoucher } from "../sync/paymentVouchersReportsTransport";
import type { ArAgeingEntry } from "../sync/paymentsCreditNotesTransport";

export interface PartyContact {
  id: string;
  displayName: string;
  contactPhone: string | null;
}

export interface CfoActionFeedSources {
  /** Cash/Bank (account 1000) balance; resolve null when the account is absent. */
  cashBalance(): Promise<number | null>;
  arAgeing(): Promise<ArAgeingEntry[]>;
  paymentVouchers(): Promise<PaymentVoucher[]>;
  approvalTasks(): Promise<ApprovalTask[]>;
  dueContractAlerts(): Promise<ContractAlert[]>;
  captureTriage(): Promise<CaptureTriageItem[]>;
  parties(): Promise<PartyContact[]>;
}

export interface LoadedCfoActionFeed {
  feed: CfoActionFeed;
  /** Plain-language labels of sources that could not be read. */
  failedSources: string[];
  /** partyId -> raw contact phone (may be null), for reminder links. */
  partyPhones: Record<string, string | null>;
}

export const SOURCE_LABELS = {
  cashBalance: "Cash position",
  arAgeing: "AR Ageing",
  paymentVouchers: "Payment Vouchers",
  approvalTasks: "Approvals",
  dueContractAlerts: "Contract alerts",
  captureTriage: "Capture Triage",
  parties: "Customer names",
} as const;

export async function loadCfoActionFeed(
  sources: CfoActionFeedSources,
  options?: CfoActionFeedOptions,
): Promise<LoadedCfoActionFeed> {
  const [cash, ar, pvs, tasks, alerts, triage, parties] =
    await Promise.allSettled([
      sources.cashBalance(),
      sources.arAgeing(),
      sources.paymentVouchers(),
      sources.approvalTasks(),
      sources.dueContractAlerts(),
      sources.captureTriage(),
      sources.parties(),
    ]);

  const failedSources: string[] = [];
  function take<T>(r: PromiseSettledResult<T>, fallback: T, label: string): T {
    if (r.status === "fulfilled") return r.value;
    failedSources.push(label);
    return fallback;
  }

  const cashBalance = take(cash, null, SOURCE_LABELS.cashBalance);
  const arAgeing = take(ar, [], SOURCE_LABELS.arAgeing);
  const paymentVouchers = take(pvs, [], SOURCE_LABELS.paymentVouchers);
  const approvalTasks = take(tasks, [], SOURCE_LABELS.approvalTasks);
  const dueContractAlerts = take(alerts, [], SOURCE_LABELS.dueContractAlerts);
  const captureTriage = take(triage, [], SOURCE_LABELS.captureTriage);
  const partyList = take(parties, [], SOURCE_LABELS.parties);

  const feed = buildCfoActionFeed(
    {
      cashBalance,
      arAgeing,
      paymentVouchers,
      approvalTasks,
      dueContractAlerts,
      captureTriage,
      partyNames: Object.fromEntries(
        partyList.map((p) => [p.id, p.displayName]),
      ),
    },
    options,
  );

  return {
    feed,
    failedSources,
    partyPhones: Object.fromEntries(
      partyList.map((p) => [p.id, p.contactPhone]),
    ),
  };
}
