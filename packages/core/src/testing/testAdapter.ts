import { DatabaseSync } from "node:sqlite";

import type { SqlDb } from "../db/types";

/**
 * Test-only SqlDb adapter backed by Node's built-in `node:sqlite` module
 * (Node 22+, experimental). Used exclusively by Jest tests — production
 * code never imports this file. See db/opSqliteAdapter.ts for the real,
 * on-device, SQLCipher-encrypted adapter.
 *
 * node:sqlite's own API is synchronous; it is wrapped here to satisfy the
 * async SqlDb interface (which matches op-sqlite's real, Promise-based API)
 * so the exact same repository code path is exercised in tests as in
 * production. Why node:sqlite and not a package like better-sqlite3:
 * better-sqlite3 needs a native compile step that downloads prebuilt
 * binaries / Node headers over the network — unavailable in some sandboxed
 * environments. node:sqlite ships with Node itself, so there is nothing to
 * install or compile. Both are real SQLite, so behaviour (including
 * triggers, which the immutability test depends on) is equivalent for this
 * project's purposes — this only verifies the portable SQL schema/logic,
 * not op-sqlite's native SQLCipher encryption layer (see opSqliteAdapter.ts).
 */
export function createTestDb(): SqlDb {
  const raw = new DatabaseSync(":memory:");
  return {
    async execute(sql, params = []) {
      if (params.length === 0) {
        raw.exec(sql);
        return;
      }
      raw.prepare(sql).run(...(params as never[]));
    },
    async queryAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return raw.prepare(sql).all(...(params as never[])) as T[];
    },
  };
}
