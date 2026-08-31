import {
  generateBusinessEventId,
  recordManualCapture,
  listRecentActivity,
} from "@aifa/core/db/businessEventRepository";
import { runMigrations } from "@aifa/core/db/migrations";
import type { SqlDb } from "@aifa/core/db/types";
import { createTestDb } from "@aifa/core/testing/testAdapter";

async function setup(): Promise<SqlDb> {
  const db = createTestDb();
  await runMigrations(db);
  return db;
}

describe("generateBusinessEventId", () => {
  // Uses today's real date rather than a hardcoded one: recordManualCapture
  // (and every other insert path) always stamps rows with `new Date()`
  // (real wall-clock time), not a caller-supplied date, so a hardcoded
  // date here would only pass on the day it was written and silently fail
  // once the sandbox's clock ticks past it — exactly what happened once
  // already (a hardcoded "2026-08-01" broke the moment the real date
  // became 2026-08-02). generateBusinessEventId itself is still exercised
  // with an explicit Date argument; only the test's *expectations* need to
  // track the real date.
  function todayDatePart(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${yyyy}${mm}${dd}`;
  }

  it("produces the BE-YYYYMMDD-NNNN format", async () => {
    const db = await setup();
    const id = await generateBusinessEventId(db, new Date());
    expect(id).toMatch(new RegExp(`^BE-${todayDatePart()}-\\d{4}$`));
  });

  it("increments the sequence for the same day", async () => {
    const db = await setup();
    const businessId = "biz-1";
    await recordManualCapture(db, {
      businessId,
      domainHint: "expense",
      dataType: "expense",
      description: "Office stationery",
      amount: 250,
      currency: "MYR",
      paymentMethod: "cash",
    });

    const secondId = await generateBusinessEventId(db, new Date());
    expect(secondId).toMatch(new RegExp(`^BE-${todayDatePart()}-0002$`));
  });
});

describe("recordManualCapture", () => {
  it("creates a confirmed BusinessEvent and its BusinessData in one call", async () => {
    const db = await setup();
    const { event, data } = await recordManualCapture(db, {
      businessId: "biz-1",
      domainHint: "expense",
      dataType: "expense",
      description: "Office stationery purchased",
      amount: 250,
      currency: "MYR",
      paymentMethod: "cash",
    });

    expect(event.status).toBe("confirmed");
    expect(event.capture_mode).toBe("text");
    expect(data.business_event_id).toBe(event.id);
    expect(data.amount).toBe(250);

    const stored = await db.queryAll(
      `SELECT * FROM business_events WHERE id = ?;`,
      [event.id],
    );
    expect(stored).toHaveLength(1);
  });
});

describe("immutability (Vol 4_0 Section 7)", () => {
  it("rejects an UPDATE against a confirmed BusinessEvent", async () => {
    const db = await setup();
    const { event } = await recordManualCapture(db, {
      businessId: "biz-1",
      domainHint: "expense",
      dataType: "expense",
      description: "Office stationery purchased",
      amount: 250,
      currency: "MYR",
      paymentMethod: "cash",
    });

    await expect(
      db.execute(
        `UPDATE business_events SET domain_hint = 'sale' WHERE id = ?;`,
        [event.id],
      ),
    ).rejects.toThrow(/immutable once confirmed/);
  });

  it("allows updates on non-confirmed rows (future async status transitions)", async () => {
    const db = await setup();
    await db.execute(
      `INSERT INTO business_events (id, business_id, captured_at, capture_mode, raw_input_ref, status, superseded_by, domain_hint)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        "BE-20260801-0099",
        "biz-1",
        new Date().toISOString(),
        "photo",
        null,
        "queued",
        null,
        "expense",
      ],
    );

    await expect(
      db.execute(
        `UPDATE business_events SET status = 'processing' WHERE id = ?;`,
        ["BE-20260801-0099"],
      ),
    ).resolves.not.toThrow();
  });
});

describe("listRecentActivity", () => {
  it("returns events in reverse-chronological order, scoped to the business", async () => {
    const db = await setup();
    const businessId = "biz-1";

    await recordManualCapture(db, {
      businessId,
      domainHint: "expense",
      dataType: "expense",
      description: "First expense",
      amount: 10,
      currency: "MYR",
      paymentMethod: "cash",
    });
    await recordManualCapture(db, {
      businessId,
      domainHint: "expense",
      dataType: "expense",
      description: "Second expense",
      amount: 20,
      currency: "MYR",
      paymentMethod: "cash",
    });
    await recordManualCapture(db, {
      businessId: "other-business",
      domainHint: "expense",
      dataType: "expense",
      description: "Different business",
      amount: 999,
      currency: "MYR",
      paymentMethod: "cash",
    });

    const activity = await listRecentActivity(db, businessId);
    expect(activity).toHaveLength(2);
    expect(activity[0].event.raw_input_ref).toContain("Second");
  });
});
