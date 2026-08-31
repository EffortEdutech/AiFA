import { runMigrations } from "@aifa/core/db/migrations";
import { createTestDb } from "@aifa/core/testing/testAdapter";

describe("migrations", () => {
  it("creates the schema_migrations, business_events, and business_data tables", async () => {
    const db = createTestDb();
    await runMigrations(db);

    const tables = (
      await db.queryAll<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`,
      )
    ).map((r) => r.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        "schema_migrations",
        "business_events",
        "business_data",
        "ledger_entries",
        "ai_interpretations",
        "documents",
        "document_blobs",
        "bank_reconciliations",
        "business_knowledge_entries",
        "app_settings",
        "app_error_log",
      ]),
    );
  });

  it("records every applied migration version", async () => {
    const db = createTestDb();
    await runMigrations(db);

    const applied = await db.queryAll<{ version: number }>(
      `SELECT version FROM schema_migrations;`,
    );
    expect(applied.map((r) => r.version).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it("is idempotent — running migrations twice does not error", async () => {
    const db = createTestDb();
    await expect(async () => {
      await runMigrations(db);
      await runMigrations(db);
    }).not.toThrow();
  });
});
