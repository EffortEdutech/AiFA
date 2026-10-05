/**
 * CFO Action Feed ("Money Moves") — packages/core/src/ai/cfoActionFeed.ts.
 * Pure-function tests: no DB, no network, no AI provider.
 */
import {
  buildCfoActionFeed,
  type CfoActionFeedInput,
} from "@aifa/core/ai/cfoActionFeed";
import type { ApprovalTask } from "@aifa/core/sync/approvalEngineTransport";
import type { CaptureTriageItem } from "@aifa/core/sync/captureTriageTransport";
import type { ContractAlert } from "@aifa/core/sync/legalCommercialTransport";
import type { PaymentVoucher } from "@aifa/core/sync/paymentVouchersReportsTransport";
import type { ArAgeingEntry } from "@aifa/core/sync/paymentsCreditNotesTransport";

const NOW = new Date("2026-10-01T09:00:00.000Z");
const BIZ = "biz-1";

function emptyInput(
  overrides: Partial<CfoActionFeedInput> = {},
): CfoActionFeedInput {
  return {
    cashBalance: 10000,
    arAgeing: [],
    paymentVouchers: [],
    approvalTasks: [],
    dueContractAlerts: [],
    captureTriage: [],
    ...overrides,
  };
}

function ar(
  id: string,
  daysOverdue: number,
  outstandingBalance: number,
  partyId = "p-1",
): ArAgeingEntry {
  return {
    invoiceId: id,
    invoiceNo: `INV-${id}`,
    partyId,
    dueDate: "2026-09-01",
    outstandingBalance,
    daysOverdue,
    ageingBucket:
      daysOverdue <= 0 ? "current" : daysOverdue <= 30 ? "1-30" : "31-60",
  };
}

function pv(
  id: string,
  status: PaymentVoucher["status"],
  grandTotal: number,
): PaymentVoucher {
  return {
    id,
    businessId: BIZ,
    pvNo: `PV-${id}`,
    payeePartyId: "s-1",
    status,
    expenseCategory: "utilities",
    documentIdReceipt: null,
    paymentMethod: "bank_transfer",
    issueDate: "2026-09-20",
    currency: "MYR",
    grandTotal,
    notes: null,
    capturedByMembershipId: null,
    createdAt: "2026-09-20T00:00:00.000Z",
  };
}

function task(
  id: string,
  status: ApprovalTask["status"],
  createdAt: string,
  amount: number | null = 100,
): ApprovalTask {
  return {
    id,
    businessId: BIZ,
    domain: "expense",
    subjectType: "payment_voucher",
    subjectId: `sub-${id}`,
    amount,
    aiDraftSummary: null,
    aiConfidence: null,
    capturedByMembershipId: null,
    assignedMembershipId: null,
    resolvedVia: "direct_permission",
    delegatedFromMembershipId: null,
    status,
    decidedByMembershipId: null,
    decidedAt: null,
    nextAction: null,
    selfApprovedViaEscapeValve: false,
    createdAt,
  };
}

function alert(
  id: string,
  alertType: ContractAlert["alertType"],
  status: ContractAlert["status"] = "pending",
): ContractAlert {
  return {
    id,
    contractId: `c-${id}`,
    alertType,
    triggerDate: "2026-09-30",
    status,
    notifiedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

function triage(
  id: string,
  status: CaptureTriageItem["status"],
): CaptureTriageItem {
  return {
    id,
    businessId: BIZ,
    rawText: "something",
    detectedDomain: null,
    status,
    createdByMembershipId: null,
    createdAt: "2026-09-30T00:00:00.000Z",
  };
}

describe("buildCfoActionFeed", () => {
  it("returns an honest empty feed when nothing needs attention", () => {
    const feed = buildCfoActionFeed(emptyInput(), { now: NOW });
    expect(feed.actions).toEqual([]);
    expect(feed.totalCandidates).toBe(0);
    expect(feed.generatedAt).toBe(NOW.toISOString());
  });

  it("ignores current (not overdue) and fully-paid receivables", () => {
    const feed = buildCfoActionFeed(
      emptyInput({ arAgeing: [ar("a", 0, 500), ar("b", 10, 0)] }),
      { now: NOW },
    );
    expect(feed.actions).toEqual([]);
  });

  it("ranks older overdue invoices above newer ones and uses party names when given", () => {
    const feed = buildCfoActionFeed(
      emptyInput({
        arAgeing: [ar("new", 3, 9000), ar("old", 75, 200, "p-2")],
        partyNames: { "p-2": "Sunrise Trading" },
      }),
      { now: NOW },
    );
    expect(feed.actions.map((a) => a.id)).toEqual([
      "overdue_receivable:old",
      "overdue_receivable:new",
    ]);
    expect(feed.actions[0].title).toBe(
      "Chase Sunrise Trading (INV-old) — RM200.00 overdue",
    );
    expect(feed.actions[0].targetPage).toBe("ar-ageing");
    expect(feed.actions[1].title).toBe("Chase INV-new — RM9000.00 overdue");
  });

  it("flags a cash shortfall at top priority when approved vouchers exceed cash", () => {
    const feed = buildCfoActionFeed(
      emptyInput({
        cashBalance: 1000,
        paymentVouchers: [
          pv("1", "approved", 800),
          pv("2", "approved", 700),
          pv("3", "paid", 5000),
        ],
        arAgeing: [ar("x", 90, 50)],
      }),
      { now: NOW },
    );
    expect(feed.actions[0].kind).toBe("cash_shortfall");
    expect(feed.actions[0].amount).toBe(500);
    expect(feed.actions[0].why).toContain(
      "2 approved voucher(s) total RM1500.00",
    );
    expect(
      feed.actions.some((a) => a.kind === "approved_unpaid_vouchers"),
    ).toBe(false);
  });

  it("suggests paying approved vouchers when cash covers them, and says so when cash is unknown", () => {
    const covered = buildCfoActionFeed(
      emptyInput({
        cashBalance: 5000,
        paymentVouchers: [pv("1", "approved", 800), pv("2", "draft", 99)],
      }),
      { now: NOW },
    );
    expect(covered.actions).toHaveLength(1);
    expect(covered.actions[0].kind).toBe("approved_unpaid_vouchers");
    expect(covered.actions[0].amount).toBe(800);

    const unknown = buildCfoActionFeed(
      emptyInput({
        cashBalance: null,
        paymentVouchers: [pv("1", "approved", 999999)],
      }),
      { now: NOW },
    );
    expect(unknown.actions[0].kind).toBe("approved_unpaid_vouchers");
    expect(unknown.actions[0].why).toContain("Cash balance unknown");
  });

  it("aggregates only stale pending approvals into one action", () => {
    const feed = buildCfoActionFeed(
      emptyInput({
        approvalTasks: [
          task("old", "pending_approval", "2026-09-26T09:00:00.000Z", 300),
          task("fresh", "pending_approval", "2026-10-01T08:00:00.000Z", 50),
          task("done", "approved", "2026-09-01T00:00:00.000Z", 1000),
        ],
      }),
      { now: NOW },
    );
    expect(feed.actions).toHaveLength(1);
    expect(feed.actions[0]).toMatchObject({
      id: "stale_approvals",
      title: "1 approval(s) waiting on you",
      amount: 300,
      targetPage: "approvals",
    });
    expect(feed.actions[0].priority).toBe(55 + 10);
  });

  it("surfaces only pending contract alerts, expired above expiring above renewal", () => {
    const feed = buildCfoActionFeed(
      emptyInput({
        dueContractAlerts: [
          alert("r", "renewal_upcoming"),
          alert("e", "expired"),
          alert("x", "expiring"),
          alert("ack", "expired", "acknowledged"),
        ],
      }),
      { now: NOW },
    );
    expect(feed.actions.map((a) => a.id)).toEqual([
      "contract_alert:e",
      "contract_alert:x",
      "contract_alert:r",
    ]);
  });

  it("counts only pending triage items", () => {
    const feed = buildCfoActionFeed(
      emptyInput({
        captureTriage: [
          triage("1", "pending"),
          triage("2", "pending"),
          triage("3", "resolved"),
        ],
      }),
      { now: NOW },
    );
    expect(feed.actions).toHaveLength(1);
    expect(feed.actions[0].title).toBe("2 capture(s) AiFA could not file");
  });

  it("caps the list at the limit but reports all candidates, deterministically", () => {
    const input = emptyInput({
      arAgeing: [
        ar("1", 5, 10),
        ar("2", 5, 20),
        ar("3", 5, 30),
        ar("4", 5, 40),
        ar("5", 5, 50),
        ar("6", 5, 60),
      ],
    });
    const a = buildCfoActionFeed(input, { now: NOW });
    const b = buildCfoActionFeed(input, { now: NOW });
    expect(a.actions).toHaveLength(5);
    expect(a.totalCandidates).toBe(6);
    // equal priority -> larger amount first
    expect(a.actions[0].id).toBe("overdue_receivable:6");
    expect(a).toEqual(b);
    expect(
      buildCfoActionFeed(input, { now: NOW, limit: 2 }).actions,
    ).toHaveLength(2);
  });
});
