/**
 * Minimal engine-agnostic SQL interface — Vol 11_0 §3.
 *
 * Async throughout: op-sqlite's real API (checked against the installed
 * package, node_modules/@op-engineering/op-sqlite) is Promise-based for
 * every execute/query call — there is no synchronous local-execute variant
 * in this version. Repository code depends on this interface, not on
 * op-sqlite directly, so Sprint 2's unit tests can run against Node's
 * built-in node:sqlite (see db/testAdapter.ts) while production runs
 * against op-sqlite + SQLCipher on-device.
 */
export interface SqlDb {
  execute(sql: string, params?: unknown[]): Promise<void>;
  queryAll<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
}
