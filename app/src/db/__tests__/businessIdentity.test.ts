import { getBusinessEventById } from "@aifa/core/db/businessEventRepository";
import { runMigrations } from "@aifa/core/db/migrations";
import type { SqlDb } from "@aifa/core/db/types";
import { reconcileLocalBusinessId } from "@aifa/core/sync/businessIdentity";
import { createTestDb } from "@aifa/core/testing/testAdapter";

const OLD_BUSINESS_ID = "local-random-abc123";
const CANONICAL_BUSINESS_ID = "11111111-2222-3333-4444-555555555555"; // stand-in for auth.uid()

async function seed(db: SqlDb) {
  await db.execute(
    `INSERT INTO business_events
       (id, business_id, captured_at, capture_mode, raw_input_ref, status, superseded_by, domain_hint)
     VALUES (?, ?, ?, 'text', ?, 'draft', NULL, 'expense');`,
    ["evt-1", OLD_BUSINESS_ID, new Date().toISOString(), "test note"],
  );
  await db.execute(
    `INSERT INTO app_settings (business_id, business_name, updated_at) VALUES (?, ?, ?);`,
    [OLD_BUSINESS_ID, "Test Business", new Date().toISOString()],
  );
  await db.execute(
    `INSERT INTO business_knowledge_entries (id, business_id, pattern_type, key, value, confirmation_count, confirmed_at)
     VALUES (?, ?, 'vendor_category_mapping', 'Acme Supplies', 'Operating Expenses:Supplies', 3, ?);`,
    ["bke-1", OLD_BUSINESS_ID, new Date().toISOString()],
  );
}

describe("reconcileLocalBusinessId", () => {
  it("repoints every business_id-bearing table from the old local id to the canonical one", async () => {
    const db = createTestDb();
    await runMigrations(db);
    await seed(db);

    await reconcileLocalBusinessId(db, OLD_BUSINESS_ID, CANONICAL_BUSINESS_ID);

    const events = await db.queryAll<{ business_id: string }>(
      `SELECT business_id FROM business_events;`,
    );
    const settings = await db.queryAll<{ business_id: string }>(
      `SELECT business_id FROM app_settings;`,
    );
    const knowledge = await db.queryAll<{ business_id: string }>(
      `SELECT business_id FROM business_knowledge_entries;`,
    );

    expect(events.every((r) => r.business_id === CANONICAL_BUSINESS_ID)).toBe(
      true,
    );
    expect(settings.every((r) => r.business_id === CANONICAL_BUSINESS_ID)).toBe(
      true,
    );
    expect(
      knowledge.every((r) => r.business_id === CANONICAL_BUSINESS_ID),
    ).toBe(true);

    // Nothing under the old id should remain.
    const staleEvents = await db.queryAll(
      `SELECT 1 FROM business_events WHERE business_id = ?;`,
      [OLD_BUSINESS_ID],
    );
    expect(staleEvents).toHaveLength(0);
  });

  it("preserves the row's own data — only business_id changes", async () => {
    const db = createTestDb();
    await runMigrations(db);
    await seed(db);

    await reconcileLocalBusinessId(db, OLD_BUSINESS_ID, CANONICAL_BUSINESS_ID);

    const event = await getBusinessEventById(db, "evt-1");
    expect(event?.raw_input_ref).toBe("test note");
    expect(event?.business_id).toBe(CANONICAL_BUSINESS_ID);
  });

  it("is a safe no-op when the ids already match", async () => {
    const db = createTestDb();
    await runMigrations(db);
    await seed(db);

    await reconcileLocalBusinessId(db, OLD_BUSINESS_ID, CANONICAL_BUSINESS_ID);
    // Calling again with the (now-current) canonical id on both sides
    // should not throw and should not touch anything.
    await expect(
      reconcileLocalBusinessId(
        db,
        CANONICAL_BUSINESS_ID,
        CANONICAL_BUSINESS_ID,
      ),
    ).resolves.not.toThrow();

    const events = await db.queryAll<{ business_id: string }>(
      `SELECT business_id FROM business_events;`,
    );
    expect(events.every((r) => r.business_id === CANONICAL_BUSINESS_ID)).toBe(
      true,
    );
  });

  it("rejects missing ids", async () => {
    const db = createTestDb();
    await runMigrations(db);

    await expect(
      reconcileLocalBusinessId(db, "", CANONICAL_BUSINESS_ID),
    ).rejects.toThrow();
    await expect(
      reconcileLocalBusinessId(db, OLD_BUSINESS_ID, ""),
    ).rejects.toThrow();
  });
});
