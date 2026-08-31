import type { SqlDb } from "@aifa/core/db/types";
import type { DB } from "@op-engineering/op-sqlite";

/**
 * Adapts an op-sqlite DB instance to the engine-agnostic SqlDb interface
 * (Vol 11_0 §3). This is the production adapter — on-device, SQLCipher-
 * encrypted. op-sqlite's execute() is Promise-based; SqlDb mirrors that
 * exactly rather than hiding it, so callers don't get surprised by hidden
 * async behaviour. See db/testAdapter.ts for the plain-Node equivalent
 * used in unit tests.
 */
export function toSqlDb(db: DB): SqlDb {
  return {
    async execute(sql, params) {
      await db.execute(sql, params as never);
    },
    async queryAll<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = await db.execute(sql, params as never);
      return (result.rows ?? []) as T[];
    },
  };
}
