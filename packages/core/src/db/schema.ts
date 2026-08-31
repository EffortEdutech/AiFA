/**
 * Public re-export surface for the migration system.
 *
 * Migration definitions live in migrations.ts (pure SQL, engine-agnostic,
 * unit-testable). This file exists so other modules have one stable import
 * path (`@/db/schema`) regardless of how the migration internals evolve.
 */
export { migrations, runMigrations } from "./migrations";
export type { Migration } from "./migrations";
export type { SqlDb } from "./types";
