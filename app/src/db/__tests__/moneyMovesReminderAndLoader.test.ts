/**
 * Money Moves slice 3/4 — packages/core/src/ai/paymentReminder.ts and
 * packages/core/src/ai/cfoActionFeedLoader.ts. Pure tests: no DB, no
 * network, nothing sent.
 */
import { buildCfoActionFeed } from "@aifa/core/ai/cfoActionFeed";
import {
  loadCfoActionFeed,
  type CfoActionFeedSources,
} from "@aifa/core/ai/cfoActionFeedLoader";
import {
  buildWhatsAppLink,
  draftPaymentReminder,
  normaliseMyPhoneE164,
  reminderToneFor,
} from "@aifa/core/ai/paymentReminder";
import type { ArAgeingEntry } from "@aifa/core/sync/paymentsCreditNotesTransport";

const NOW = new Date("2026-10-05T09:00:00.000Z");

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

function okSources(
  overrides: Partial<CfoActionFeedSources> = {},
): CfoActionFeedSources {
  return {
    cashBalance: async () => 5000,
    arAgeing: async () => [],
    paymentVouchers: async () => [],
    approvalTasks: async () => [],
    dueContractAlerts: async () => [],
    captureTriage: async () => [],
    parties: async () => [],
    ...overrides,
  };
}

describe("reminderToneFor", () => {
  it("steps up friendly -> firm -> final at 30 and 60 days", () => {
    expect([1, 30, 31, 60, 61].map(reminderToneFor)).toEqual([
      "friendly",
      "friendly",
      "firm",
      "firm",
      "final",
    ]);
  });
});

describe("draftPaymentReminder", () => {
  const base = {
    customerName: "Sunrise Trading",
    invoiceNo: "INV-0012",
    outstandingBalance: 800,
    dueDate: "2026-09-20",
    daysOverdue: 15,
  };

  it("drafts a friendly English reminder with the exact facts", () => {
    const text = draftPaymentReminder(base);
    expect(text).toContain("Hi Sunrise Trading,");
    expect(text).toContain("friendly reminder");
    expect(text).toContain("INV-0012");
    expect(text).toContain("RM800.00");
    expect(text).toContain("2026-09-20");
    expect(text).toContain("15 day(s) ago");
  });

  it("uses firm and final wording as lateness grows", () => {
    expect(draftPaymentReminder({ ...base, daysOverdue: 45 })).toContain(
      "as soon as possible",
    );
    expect(draftPaymentReminder({ ...base, daysOverdue: 90 })).toContain(
      "final reminder",
    );
  });

  it("drafts Bahasa Melayu when asked", () => {
    const text = draftPaymentReminder(base, "ms");
    expect(text).toContain("Salam sejahtera Sunrise Trading,");
    expect(text).toContain("invois INV-0012");
    expect(text).toContain("RM800.00");
    expect(draftPaymentReminder({ ...base, daysOverdue: 90 }, "ms")).toContain(
      "notis akhir",
    );
  });

  it("falls back to a neutral greeting and adds a sign-off only when given", () => {
    expect(draftPaymentReminder({ ...base, customerName: null })).toMatch(
      /^Hello,/,
    );
    expect(draftPaymentReminder({ ...base, customerName: "  " }, "ms")).toMatch(
      /^Salam sejahtera,/,
    );
    expect(
      draftPaymentReminder({ ...base, businessName: "Verify Test Co" }),
    ).toMatch(/\n\nVerify Test Co$/);
    expect(draftPaymentReminder(base)).toMatch(/Thank you\.$/);
  });
});

describe("normaliseMyPhoneE164", () => {
  it("normalises common Malaysian formats", () => {
    expect(normaliseMyPhoneE164("012-345 6789")).toBe("60123456789");
    expect(normaliseMyPhoneE164("+60 12-345 6789")).toBe("60123456789");
    expect(normaliseMyPhoneE164("0060123456789")).toBe("60123456789");
    expect(normaliseMyPhoneE164("60123456789")).toBe("60123456789");
  });

  it("returns null for missing or junk numbers", () => {
    expect(normaliseMyPhoneE164(null)).toBeNull();
    expect(normaliseMyPhoneE164("")).toBeNull();
    expect(normaliseMyPhoneE164("call me")).toBeNull();
    expect(normaliseMyPhoneE164("123")).toBeNull();
  });
});

describe("buildWhatsAppLink", () => {
  it("encodes the text and includes the phone when known", () => {
    expect(buildWhatsAppLink("60123456789", "Hi & thanks\nok")).toBe(
      "https://wa.me/60123456789?text=Hi%20%26%20thanks%0Aok",
    );
    expect(buildWhatsAppLink(null, "Hi")).toBe("https://wa.me/?text=Hi");
  });
});

describe("overdue actions carry invoice details for reminders", () => {
  it("attaches the invoice reference, with party name when known", () => {
    const feed = buildCfoActionFeed(
      {
        cashBalance: 1000,
        arAgeing: [ar("a", 40, 300, "p-2")],
        paymentVouchers: [],
        approvalTasks: [],
        dueContractAlerts: [],
        captureTriage: [],
        partyNames: { "p-2": "Sunrise Trading" },
      },
      { now: NOW },
    );
    expect(feed.actions[0].invoice).toEqual({
      invoiceId: "a",
      invoiceNo: "INV-a",
      partyId: "p-2",
      partyName: "Sunrise Trading",
      outstandingBalance: 300,
      dueDate: "2026-09-01",
      daysOverdue: 40,
    });
  });
});

describe("loadCfoActionFeed", () => {
  it("builds the feed and returns party names and phones", async () => {
    const loaded = await loadCfoActionFeed(
      okSources({
        arAgeing: async () => [ar("x", 10, 200, "p-9")],
        parties: async () => [
          { id: "p-9", displayName: "Kedai Ali", contactPhone: "012-3456789" },
        ],
      }),
      { now: NOW },
    );
    expect(loaded.failedSources).toEqual([]);
    expect(loaded.feed.actions[0].title).toBe(
      "Chase Kedai Ali (INV-x) — RM200.00 overdue",
    );
    expect(loaded.partyPhones).toEqual({ "p-9": "012-3456789" });
  });

  it("keeps going when some sources fail, and names them", async () => {
    const loaded = await loadCfoActionFeed(
      okSources({
        arAgeing: async () => [ar("x", 10, 200)],
        cashBalance: async () => {
          throw new Error("permission denied");
        },
        approvalTasks: async () => {
          throw new Error("network");
        },
      }),
      { now: NOW },
    );
    expect(loaded.failedSources).toEqual(["Cash position", "Approvals"]);
    expect(loaded.feed.actions).toHaveLength(1);
    expect(loaded.feed.actions[0].kind).toBe("overdue_receivable");
  });

  it("returns an empty feed with every source named when everything fails", async () => {
    const boom = async (): Promise<never> => {
      throw new Error("offline");
    };
    const loaded = await loadCfoActionFeed(
      {
        cashBalance: boom,
        arAgeing: boom,
        paymentVouchers: boom,
        approvalTasks: boom,
        dueContractAlerts: boom,
        captureTriage: boom,
        parties: boom,
      },
      { now: NOW },
    );
    expect(loaded.feed.actions).toEqual([]);
    expect(loaded.failedSources).toHaveLength(7);
  });
});
