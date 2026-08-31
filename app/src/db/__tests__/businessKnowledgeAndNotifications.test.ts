/**
 * Sprint 8 — Business Knowledge heuristic (Vol 4_2, Vol 11_1 §7) and
 * Notifications (Vol 7_5) tests.
 */
import {
  confirmCategory,
  runCaptureInterpretation,
} from "@aifa/core/ai/capturePipeline";
import {
  getNotifications,
  NOTIFICATION_DAILY_CAP,
} from "@aifa/core/ai/notificationEngine";
import { ScriptedCaptureProvider } from "@aifa/core/ai/providers/scriptedProvider";
import {
  getTrustedVendorCategory,
  recordVendorCategoryConfirmation,
  TRUSTED_CONFIRMATION_THRESHOLD,
} from "@aifa/core/db/businessKnowledgeRepository";
import { runMigrations } from "@aifa/core/db/migrations";
import type { SqlDb } from "@aifa/core/db/types";
import { createTestDb } from "@aifa/core/testing/testAdapter";

async function setupDb(): Promise<SqlDb> {
  const db = createTestDb();
  await runMigrations(db);
  return db;
}

const moderateExpenseProvider = (category: string, confidence: number) =>
  new ScriptedCaptureProvider(() => ({
    category,
    confidence,
    reasoning: "Plausible, not fully certain.",
    clarifying_question: null,
    matched_rule_ids: ["EXP-001"],
  }));

const saleProvider = () =>
  new ScriptedCaptureProvider(() => ({
    category: "Sales Revenue",
    confidence: 0.95,
    reasoning: "Clear invoice.",
    clarifying_question: null,
    matched_rule_ids: ["SALE-001"],
  }));

async function captureCreditSale(
  db: SqlDb,
  amount: number,
  counterparty: string,
) {
  return runCaptureInterpretation(db, saleProvider(), {
    domain: "sale",
    businessId: "biz-1",
    description: "Sold on credit",
    counterpartyName: counterparty,
    amount,
    currency: "MYR",
    paymentMethod: "unspecified",
  });
}

async function captureExpenseDraft(
  db: SqlDb,
  vendor: string,
  category: string,
  confidence: number,
) {
  return runCaptureInterpretation(
    db,
    moderateExpenseProvider(category, confidence),
    {
      domain: "expense",
      businessId: "biz-1",
      description: "Bought supplies",
      counterpartyName: vendor,
      amount: 50,
      currency: "MYR",
      paymentMethod: "cash",
    },
  );
}

describe("businessKnowledgeRepository — vendor mapping streak (Vol 11_1 §7)", () => {
  test("a fresh vendor starts at confirmation_count 1 and is not yet trusted", async () => {
    const db = await setupDb();
    const entry = await recordVendorCategoryConfirmation(
      db,
      "biz-1",
      "Office Supplies Co",
      "Operating Expenses:Supplies",
    );
    expect(entry.confirmation_count).toBe(1);
    expect(
      await getTrustedVendorCategory(db, "biz-1", "Office Supplies Co"),
    ).toBeNull();
  });

  test(`crosses trusted at ${TRUSTED_CONFIRMATION_THRESHOLD} consecutive confirmations of the same category`, async () => {
    const db = await setupDb();
    for (let i = 0; i < TRUSTED_CONFIRMATION_THRESHOLD; i++) {
      await recordVendorCategoryConfirmation(
        db,
        "biz-1",
        "Office Supplies Co",
        "Operating Expenses:Supplies",
      );
    }
    expect(
      await getTrustedVendorCategory(db, "biz-1", "Office Supplies Co"),
    ).toBe("Operating Expenses:Supplies");
  });

  test("a differing confirmation resets the streak rather than incrementing it", async () => {
    const db = await setupDb();
    await recordVendorCategoryConfirmation(
      db,
      "biz-1",
      "Mixed Vendor",
      "Operating Expenses:Supplies",
    );
    await recordVendorCategoryConfirmation(
      db,
      "biz-1",
      "Mixed Vendor",
      "Operating Expenses:Supplies",
    );
    // Third confirmation disagrees -- streak should reset to 1 under the
    // new value, not reach 3 under the old one.
    const afterSwitch = await recordVendorCategoryConfirmation(
      db,
      "biz-1",
      "Mixed Vendor",
      "Operating Expenses:Marketing",
    );
    expect(afterSwitch.confirmation_count).toBe(1);
    expect(afterSwitch.value).toBe("Operating Expenses:Marketing");
    expect(
      await getTrustedVendorCategory(db, "biz-1", "Mixed Vendor"),
    ).toBeNull();
  });
});

describe("capturePipeline — trusted mapping confidence boost (Vol 4_2 §6)", () => {
  test("4th occurrence of a 3x-confirmed vendor auto-categorises even at moderate AI confidence", async () => {
    const db = await setupDb();
    const vendor = "Office Supplies Co";
    const category = "Operating Expenses:Supplies";

    for (let i = 0; i < TRUSTED_CONFIRMATION_THRESHOLD; i++) {
      const outcome = await captureExpenseDraft(db, vendor, category, 0.7);
      expect(outcome.decision).toBe("draft_confirm");
      await confirmCategory(db, outcome.event, outcome.data, category, "cash");
    }

    // Mapping is now trusted; the 4th capture is scripted to return the
    // SAME category but at only 0.65 confidence -- below auto_record_min
    // (0.90) on its own. The trust boost should still push it through.
    const fourth = await captureExpenseDraft(db, vendor, category, 0.65);
    expect(fourth.decision).toBe("auto_record");
    expect(fourth.confidence).toBeGreaterThanOrEqual(0.95);
    expect(fourth.event.status).toBe("confirmed");
    expect(fourth.category).toBe(category);
  });

  test("does not override when the AI's guess disagrees with the trusted mapping", async () => {
    const db = await setupDb();
    const vendor = "Disagreeing Vendor";
    const trustedCategory = "Operating Expenses:Supplies";

    for (let i = 0; i < TRUSTED_CONFIRMATION_THRESHOLD; i++) {
      const outcome = await captureExpenseDraft(
        db,
        vendor,
        trustedCategory,
        0.7,
      );
      await confirmCategory(
        db,
        outcome.event,
        outcome.data,
        trustedCategory,
        "cash",
      );
    }

    // 4th capture: AI proposes a DIFFERENT category at moderate confidence.
    // Agreement is required for the boost (Sprint 8 risk register) -- this
    // must stay at the AI's own (unboosted) confidence and route normally.
    const fourth = await captureExpenseDraft(
      db,
      vendor,
      "Operating Expenses:Marketing",
      0.65,
    );
    expect(fourth.decision).toBe("draft_confirm");
    expect(fourth.confidence).toBeCloseTo(0.65);
    expect(fourth.category).toBe("Operating Expenses:Marketing");
  });

  test("a vendor confirmed fewer than the threshold gets no boost", async () => {
    const db = await setupDb();
    const vendor = "New Vendor";
    const category = "Operating Expenses:Supplies";

    // Only 2 confirmations -- one short of trusted.
    for (let i = 0; i < TRUSTED_CONFIRMATION_THRESHOLD - 1; i++) {
      const outcome = await captureExpenseDraft(db, vendor, category, 0.7);
      await confirmCategory(db, outcome.event, outcome.data, category, "cash");
    }

    const next = await captureExpenseDraft(db, vendor, category, 0.65);
    expect(next.decision).toBe("draft_confirm");
    expect(next.confidence).toBeCloseTo(0.65);
  });
});

describe("notificationEngine.getNotifications (Vol 7_5)", () => {
  test("returns nothing when no condition is actionable", async () => {
    const db = await setupDb();
    const result = await getNotifications(db, "biz-1", {
      now: new Date(),
      quietHoursEnabled: false,
    });
    expect(result.notifications).toEqual([]);
    expect(result.suppressedByQuietHours).toBe(false);
  });

  test("fires an action-needed notification for a genuinely overdue receivable", async () => {
    const db = await setupDb();
    await captureCreditSale(db, 800, "ABC Trading");
    const thirtyOneDaysLater = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);

    const result = await getNotifications(db, "biz-1", {
      now: thirtyOneDaysLater,
      quietHoursEnabled: false,
    });

    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].kind).toBe("action_needed");
    expect(result.notifications[0].message).toContain("ABC Trading");
  });

  test("does not fire for a receivable that is not yet overdue (non-issue case)", async () => {
    const db = await setupDb();
    await captureCreditSale(db, 800, "ABC Trading");

    const result = await getNotifications(db, "biz-1", {
      now: new Date(),
      quietHoursEnabled: false,
    });

    expect(result.notifications).toEqual([]);
  });

  test("fires a confirmation-request notification for an unresolved draft", async () => {
    const db = await setupDb();
    const outcome = await captureExpenseDraft(
      db,
      "Some Vendor",
      "Operating Expenses:Supplies",
      0.7,
    );
    expect(outcome.decision).toBe("draft_confirm");

    const result = await getNotifications(db, "biz-1", {
      now: new Date(),
      quietHoursEnabled: false,
    });

    expect(
      result.notifications.some(
        (n) =>
          n.kind === "confirmation_request" &&
          n.sourceBusinessEventId === outcome.event.id,
      ),
    ).toBe(true);
  });

  test("stays within the daily cap even when multiple conditions are true at once", async () => {
    const db = await setupDb();
    await captureCreditSale(db, 100, "Vendor A");
    await captureCreditSale(db, 200, "Vendor B");
    for (let i = 0; i < 3; i++) {
      await captureExpenseDraft(
        db,
        `Draft Vendor ${i}`,
        "Operating Expenses:Supplies",
        0.7,
      );
    }
    const thirtyOneDaysLater = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);

    const result = await getNotifications(db, "biz-1", {
      now: thirtyOneDaysLater,
      quietHoursEnabled: false,
    });

    // 2 overdue + 3 confirmation-requests = 5 candidates, capped to 3.
    expect(result.notifications.length).toBeLessThanOrEqual(
      NOTIFICATION_DAILY_CAP,
    );
    expect(result.notifications).toHaveLength(NOTIFICATION_DAILY_CAP);
    // Confirmation requests are prioritised (block bookkeeping until
    // resolved, Vol 7_5 §2) -- with exactly 3 of them, they fill the cap.
    expect(
      result.notifications.every((n) => n.kind === "confirmation_request"),
    ).toBe(true);
  });

  test("quiet hours suppress delivery entirely by default", async () => {
    const db = await setupDb();
    await captureCreditSale(db, 100, "Vendor A");
    const quietMoment = new Date(Date.now() + 32 * 24 * 60 * 60 * 1000);
    quietMoment.setHours(22, 0, 0, 0);

    const result = await getNotifications(db, "biz-1", { now: quietMoment });

    expect(result.suppressedByQuietHours).toBe(true);
    expect(result.notifications).toEqual([]);
  });

  test("quiet hours can be explicitly disabled", async () => {
    const db = await setupDb();
    await captureCreditSale(db, 100, "Vendor A");
    const quietMoment = new Date(Date.now() + 32 * 24 * 60 * 60 * 1000);
    quietMoment.setHours(22, 0, 0, 0);

    const result = await getNotifications(db, "biz-1", {
      now: quietMoment,
      quietHoursEnabled: false,
    });

    expect(result.suppressedByQuietHours).toBe(false);
    expect(result.notifications.length).toBeGreaterThan(0);
  });
});
