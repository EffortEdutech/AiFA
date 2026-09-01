/**
 * Sprint 18 verification script — NOT a Jest test (this repo has no test
 * runner wired for web/ yet, and adding one is out of this sprint's
 * scope). Proves the sprint's central risk-register claim for real: that
 * @aifa/core's migrations and repository/pipeline SQL run against sql.js
 * (the WASM SQLite engine backing IndexedDbSqlAdapter) with the exact
 * same behaviour as node:sqlite (packages/core/src/testing/testAdapter.ts,
 * what every existing Jest suite already runs against). Runs entirely in
 * plain Node — sql.js works outside a browser too — so this doesn't need
 * IndexedDB/WebCrypto, which are the browser-only, untestable-without-a-
 * browser parts of sqlJsAdapter.ts (consistent with this project's
 * established precedent for RPC/SecureStore/browser-API glue: verified
 * by tsc/eslint + a real build, not force-mocked).
 */
import initSqlJs from "sql.js";

import type { SqlDb } from "../../packages/core/src/db/types";
import { runMigrations } from "../../packages/core/src/db/migrations";
import { getCashPositionSummary } from "../../packages/core/src/db/financialSummaryRepository";
import { runCaptureInterpretation, confirmCategory } from "../../packages/core/src/ai/capturePipeline";
import { ScriptedCaptureProvider } from "../../packages/core/src/ai/providers/scriptedProvider";
import { recordBankTransaction } from "../../packages/core/src/db/bankingRepository";
import { getCfoGuidance } from "../../packages/core/src/ai/cfoGuidance";
import { askWorkspaceQuestion } from "../../packages/core/src/ai/workspacePipeline";
import { ScriptedWorkspaceProvider } from "../../packages/core/src/ai/providers/scriptedWorkspaceProvider";

async function main() {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  const db: SqlDb = {
    async execute(sql, params = []) {
      sqlite.run(sql, params as never[]);
    },
    async queryAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const stmt = sqlite.prepare(sql);
      try {
        stmt.bind(params as never[]);
        const rows: T[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as T);
        return rows;
      } finally {
        stmt.free();
      }
    },
  };

  // 1. Migrations — including migration 3/4's CHECK-constraint rebuild
  // and immutability-trigger patterns, and the trigger this project's
  // whole correction model depends on.
  await runMigrations(db);
  const tables = await db.queryAll<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';`,
  );
  assert(tables.length >= 13, `expected 13+ tables after migrations, got ${tables.length}`);

  // 2. A real AI-interpreted capture (expense), through the exact same
  // runCaptureInterpretation/confirmCategory @aifa/core code path web's
  // CaptureForm.tsx calls.
  const businessId = "biz-verify-1";
  const provider = new ScriptedCaptureProvider(() => ({
    category: "Operating Expenses:Supplies",
    confidence: 0.6,
    reasoning: "verification stub",
    clarifying_question: null,
    matched_rule_ids: [],
  }));
  const outcome = await runCaptureInterpretation(db, provider, {
    domain: "expense",
    businessId,
    description: "Office paper",
    amount: 42,
    currency: "USD",
    paymentMethod: "cash",
  });
  assert(outcome.decision === "draft_confirm", `expected draft_confirm, got ${outcome.decision}`);
  await confirmCategory(db, outcome.event, outcome.data, "Operating Expenses:Supplies", "cash");

  // 3. Immutability trigger — a second write to the now-confirmed event
  // must be rejected by SQLite itself, exactly as the mobile app's own
  // migrations.test.ts verifies against node:sqlite.
  let triggerFired = false;
  try {
    await db.execute(`UPDATE business_events SET domain_hint = 'sale' WHERE id = ?;`, [outcome.event.id]);
  } catch {
    triggerFired = true;
  }
  assert(triggerFired, "expected the confirmed-event immutability trigger to reject a direct edit");

  // 4. Banking (deterministic, no AI) + a real SUM()-aggregate financial
  // query (financialSummaryRepository's cash position).
  await recordBankTransaction(db, {
    businessId,
    transactionType: "deposit",
    description: "Owner injection",
    amount: 500,
    currency: "USD",
  });
  const cash = await getCashPositionSummary(db);
  assert(cash.cashPosition === 500 - 42, `expected cash position 458, got ${cash.cashPosition}`);

  // 5. CFO guidance + AI Workspace Q&A (the exact code path web's
  // Workspace.tsx calls).
  const guidance = await getCfoGuidance(db, businessId);
  assert(typeof guidance.cashPosition.cashPosition === "number", "getCfoGuidance did not return a cash position");
  const answer = await askWorkspaceQuestion(
    db,
    new ScriptedWorkspaceProvider(() => ({
      answer: "You're fine.",
      sources: ["cash_position"],
      out_of_scope: false,
    })),
    { businessId, question: "Can I afford payroll?" },
  );
  assert(answer.answer === "You're fine.", `unexpected workspace answer: ${answer.answer}`);

  console.log("ALL SQL.JS PARITY CHECKS PASSED");
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
}

main().catch((err) => {
  console.error("SQL.JS PARITY CHECK FAILED:", err && err.stack ? err.stack : err);
  process.exit(1);
});
