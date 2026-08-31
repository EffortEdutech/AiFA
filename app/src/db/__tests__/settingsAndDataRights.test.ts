/**
 * Sprint 10 — Settings persistence, notification preference wiring, data
 * export, deletion, and the PCB security-classification fix (Vol 7_7,
 * Vol 7_5, Vol 3_1 Section 4). Covers every piece of this sprint's new
 * logic that has no native/network dependency -- the same split Sprint 9
 * established for backup (auth.ts, exportService.ts, and deletionService.ts
 * are the untestable-in-sandbox native/network counterparts, verified by
 * tsc/eslint only, same as backupService.ts).
 */
import { runCaptureInterpretation } from "@aifa/core/ai/capturePipeline";
import { getNotifications } from "@aifa/core/ai/notificationEngine";
import { buildCapturePcb, buildWorkspacePcb } from "@aifa/core/ai/pcb";
import { ScriptedCaptureProvider } from "@aifa/core/ai/providers/scriptedProvider";
import {
  DEFAULT_APP_SETTINGS,
  getAppSettings,
  updateBusinessProfile,
  updateNotificationPreferences,
} from "@aifa/core/db/appSettingsRepository";
import { recordBankTransaction } from "@aifa/core/db/bankingRepository";
import {
  LOCAL_DELETION_TABLES,
  deleteAllLocalData,
} from "@aifa/core/db/deletionRepository";
import {
  buildActivityCsv,
  buildExportBundle,
} from "@aifa/core/db/exportRepository";
import { runMigrations } from "@aifa/core/db/migrations";
import type { SqlDb } from "@aifa/core/db/types";
import { createTestDb } from "@aifa/core/testing/testAdapter";

async function setupDb(): Promise<SqlDb> {
  const db = createTestDb();
  await runMigrations(db);
  return db;
}

const BUSINESS_ID = "biz-1";

describe("appSettingsRepository", () => {
  test("returns Sprint 8 defaults when no row exists yet", async () => {
    const db = await setupDb();
    const settings = await getAppSettings(db, BUSINESS_ID);
    expect(settings).toMatchObject(DEFAULT_APP_SETTINGS);
    expect(settings.business_id).toBe(BUSINESS_ID);
  });

  test("updateBusinessProfile persists and round-trips", async () => {
    const db = await setupDb();
    const updated = await updateBusinessProfile(db, BUSINESS_ID, {
      businessName: "ABC Trading",
      industry: "Retail",
    });
    expect(updated.business_name).toBe("ABC Trading");
    expect(updated.industry).toBe("Retail");

    const reloaded = await getAppSettings(db, BUSINESS_ID);
    expect(reloaded.business_name).toBe("ABC Trading");
    expect(reloaded.industry).toBe("Retail");
    // Notification defaults untouched by a profile-only update.
    expect(reloaded.quiet_hours_enabled).toBe(true);
  });

  test("updateNotificationPreferences persists partial updates without clobbering the rest", async () => {
    const db = await setupDb();
    await updateBusinessProfile(db, BUSINESS_ID, {
      businessName: "ABC Trading",
    });

    const updated = await updateNotificationPreferences(db, BUSINESS_ID, {
      quietHoursEnabled: false,
      notifyActionNeeded: false,
    });
    expect(updated.quiet_hours_enabled).toBe(false);
    expect(updated.notify_action_needed).toBe(false);
    // Untouched fields keep their previous values.
    expect(updated.notify_confirmation_request).toBe(true);
    expect(updated.business_name).toBe("ABC Trading");
  });

  test("quiet hour values are clamped to 0-23", async () => {
    const db = await setupDb();
    const updated = await updateNotificationPreferences(db, BUSINESS_ID, {
      quietHoursStartHour: 99,
      quietHoursEndHour: -5,
    });
    expect(updated.quiet_hours_start_hour).toBe(23);
    expect(updated.quiet_hours_end_hour).toBe(0);
  });
});

const provider = () =>
  new ScriptedCaptureProvider(() => ({
    category: "Operating Expenses:Supplies",
    confidence: 0.4, // below auto-record and confirm thresholds -> needs_clarification
    reasoning: "Unclear vendor.",
    clarifying_question: "What was this for?",
    matched_rule_ids: [],
  }));

async function seedOneConfirmationRequest(db: SqlDb): Promise<void> {
  await runCaptureInterpretation(db, provider(), {
    domain: "expense",
    businessId: BUSINESS_ID,
    description: "Unclear purchase",
    counterpartyName: "Unknown Vendor",
    amount: 50,
    currency: "MYR",
    paymentMethod: "cash",
  });
}

describe("notificationEngine — Sprint 10 per-kind toggles", () => {
  test("notifyConfirmationRequest: false suppresses confirmation requests but not action-needed", async () => {
    const db = await setupDb();
    await seedOneConfirmationRequest(db);
    await recordBankTransaction(db, {
      businessId: BUSINESS_ID,
      transactionType: "deposit",
      description: "top-up",
      amount: 10,
      currency: "MYR",
    });

    // Fixed daytime `now` so this doesn't depend on the real wall-clock
    // hour the suite happens to run at -- getNotifications defaults
    // quietHoursEnabled to true with the Sprint 8 default 9pm-8am window,
    // and omitting `now` here used real time, making this test genuinely
    // flaky overnight (caught during Sprint 12's follow-up device-build
    // troubleshooting, unrelated to any Sprint 12 code change).
    const daytimeNow = new Date("2026-08-02T12:00:00");
    const withBoth = await getNotifications(db, BUSINESS_ID, {
      now: daytimeNow,
    });
    expect(
      withBoth.notifications.some((n) => n.kind === "confirmation_request"),
    ).toBe(true);

    const suppressed = await getNotifications(db, BUSINESS_ID, {
      now: daytimeNow,
      notifyConfirmationRequest: false,
    });
    expect(
      suppressed.notifications.some((n) => n.kind === "confirmation_request"),
    ).toBe(false);
  });

  test("notifyActionNeeded: false suppresses action-needed notifications", async () => {
    const db = await setupDb();
    await seedOneConfirmationRequest(db);

    const suppressed = await getNotifications(db, BUSINESS_ID, {
      now: new Date("2026-08-02T12:00:00"),
      notifyActionNeeded: false,
    });
    // The seeded item is a confirmation request, not action-needed, so it
    // should still show up even with action-needed suppressed.
    expect(suppressed.notifications.length).toBeGreaterThan(0);
    expect(
      suppressed.notifications.every((n) => n.kind !== "action_needed"),
    ).toBe(true);
  });
});

describe("exportRepository", () => {
  test("buildActivityCsv produces a header row plus one row per event, CSV-escaped", async () => {
    const db = await setupDb();
    await runCaptureInterpretation(db, provider(), {
      domain: "expense",
      businessId: BUSINESS_ID,
      description: "Lunch, coffee, and snacks",
      counterpartyName: 'Cafe "Corner"',
      amount: 25,
      currency: "MYR",
      paymentMethod: "cash",
    });

    const csv = await buildActivityCsv(db, BUSINESS_ID);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      "captured_at,domain,description,counterparty_name,amount,currency,payment_method,category,status",
    );
    expect(lines.length).toBe(2);
    // Description containing a comma is quoted; embedded quotes are doubled.
    expect(lines[1]).toContain('"Lunch, coffee, and snacks"');
    expect(lines[1]).toContain('"Cafe ""Corner"""');
  });

  test("buildExportBundle reuses the Sprint 9 snapshot format and includes both artifacts", async () => {
    const db = await setupDb();
    await recordBankTransaction(db, {
      businessId: BUSINESS_ID,
      transactionType: "deposit",
      description: "top-up",
      amount: 100,
      currency: "MYR",
    });

    const bundle = await buildExportBundle(db, BUSINESS_ID);
    expect(bundle.snapshot.snapshotVersion).toBe(1);
    expect(JSON.parse(bundle.snapshotJson).snapshotVersion).toBe(1);
    expect(bundle.activityCsv).toContain("captured_at,domain,description");
    expect(bundle.generatedAt).toBeTruthy();
  });
});

describe("deletionRepository — deleteAllLocalData", () => {
  test("clears every Phase 1 business/config table but leaves schema_migrations intact", async () => {
    const db = await setupDb();
    await runCaptureInterpretation(db, provider(), {
      domain: "expense",
      businessId: BUSINESS_ID,
      description: "Something",
      counterpartyName: "Vendor",
      amount: 10,
      currency: "MYR",
      paymentMethod: "cash",
    });
    await recordBankTransaction(db, {
      businessId: BUSINESS_ID,
      transactionType: "deposit",
      description: "top-up",
      amount: 10,
      currency: "MYR",
    });
    await updateBusinessProfile(db, BUSINESS_ID, { businessName: "ABC" });

    // Sanity: at least one of the tables actually has rows before deletion.
    const before = await db.queryAll<{ n: number }>(
      `SELECT COUNT(*) as n FROM business_events;`,
    );
    expect(before[0].n).toBeGreaterThan(0);

    await deleteAllLocalData(db);

    for (const table of LOCAL_DELETION_TABLES) {
      const rows = await db.queryAll<{ n: number }>(
        `SELECT COUNT(*) as n FROM ${table};`,
      );
      expect(rows[0].n).toBe(0);
    }

    const migrations = await db.queryAll<{ n: number }>(
      `SELECT COUNT(*) as n FROM schema_migrations;`,
    );
    expect(migrations[0].n).toBeGreaterThan(0);

    // The db is still usable afterwards -- a fresh capture works normally.
    await expect(
      runCaptureInterpretation(db, provider(), {
        domain: "expense",
        businessId: BUSINESS_ID,
        description: "After deletion",
        counterpartyName: "Vendor",
        amount: 5,
        currency: "MYR",
        paymentMethod: "cash",
      }),
    ).resolves.not.toThrow();
  });

  test("is safe to call on an already-empty database", async () => {
    const db = await setupDb();
    await expect(deleteAllLocalData(db)).resolves.not.toThrow();
  });
});

describe("PCB sensitivity_classification (Sprint 10 security audit fix)", () => {
  test("buildCapturePcb sets sensitivity_classification to 'standard'", () => {
    const pcb = buildCapturePcb({
      domain: "expense",
      businessEventId: "evt-1",
      businessDataId: "data-1",
      description: "Test",
      counterpartyName: "Vendor",
      amount: 10,
      currency: "MYR",
      paymentMethod: "cash",
    });
    expect(pcb.sensitivity_classification).toBe("standard");
  });

  test("buildWorkspacePcb sets sensitivity_classification to 'standard'", () => {
    const pcb = buildWorkspacePcb({
      cashPosition: {
        cashPosition: 0,
        moneyIn: 0,
        moneyOut: 0,
        trendDays: 30,
        currency: "MYR",
      },
      overdueReceivables: [],
      totalOverdueAmount: 0,
      upcomingPayables: [],
      totalUpcomingPayableAmount: 0,
      todayRecommendation: null,
    });
    expect(pcb.sensitivity_classification).toBe("standard");
  });
});
