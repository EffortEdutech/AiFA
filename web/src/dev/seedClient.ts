import { SEED_RPC, SEED_TABLES } from "./seedData";

/**
 * DEV-ONLY fake Supabase client for "seed mode" (VITE_SEED_MODE=1 under
 * `npm run dev`). Serves the sample rows in seedData.ts through the small
 * slice of the supabase-js query-builder surface this app uses, so pages
 * render populated without any backend. READ-ONLY: every insert/update/
 * delete/upsert and every RPC not listed in SEED_RPC resolves to an error
 * ("Seed mode is read-only"), which pages already surface as normal alerts.
 * Filters on business_id/owner ids are ignored (single seeded business).
 */
type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code?: string } | null };

const READ_ONLY = { message: "Seed mode is read-only: sample data cannot be changed.", code: "SEED_READ_ONLY" };
const IGNORED_COLUMNS = new Set(["business_id", "owner_user_id"]);

class Query implements PromiseLike<Result> {
  private rows: Row[];
  private mode: "many" | "single" | "maybe" = "many";
  private writeAttempt = false;

  constructor(rows: Row[], private readonly table = "") {
    this.rows = rows.slice();
  }

  select(): this { return this; }
  insert(): this { this.writeAttempt = true; return this; }
  update(): this { this.writeAttempt = true; return this; }
  upsert(): this { this.writeAttempt = true; return this; }
  delete(): this { this.writeAttempt = true; return this; }

  private filter(col: string, test: (v: unknown) => boolean): this {
    if (!IGNORED_COLUMNS.has(col) && !(this.table === "businesses" && col === "id")) this.rows = this.rows.filter((r) => test(r[col]));
    return this;
  }
  eq(col: string, val: unknown): this { return this.filter(col, (v) => v === val); }
  neq(col: string, val: unknown): this { return this.filter(col, (v) => v !== val); }
  in(col: string, vals: unknown[]): this { return this.filter(col, (v) => vals.includes(v)); }
  is(col: string, val: unknown): this { return this.filter(col, (v) => (val === null ? v == null : v === val)); }
  gte(col: string, val: unknown): this { return this.filter(col, (v) => String(v) >= String(val)); }
  lte(col: string, val: unknown): this { return this.filter(col, (v) => String(v) <= String(val)); }
  gt(col: string, val: unknown): this { return this.filter(col, (v) => String(v) > String(val)); }
  lt(col: string, val: unknown): this { return this.filter(col, (v) => String(v) < String(val)); }
  order(col: string, opts?: { ascending?: boolean }): this {
    const dir = opts?.ascending === false ? -1 : 1;
    this.rows.sort((a, b) => (String(a[col] ?? "") < String(b[col] ?? "") ? -dir : String(a[col] ?? "") > String(b[col] ?? "") ? dir : 0));
    return this;
  }
  limit(n: number): this { this.rows = this.rows.slice(0, n); return this; }
  single(): this { this.mode = "single"; return this; }
  maybeSingle(): this { this.mode = "maybe"; return this; }

  private run(): Result {
    if (this.writeAttempt) return { data: null, error: READ_ONLY };
    if (this.mode === "many") return { data: this.rows, error: null };
    if (this.mode === "maybe") return { data: this.rows[0] ?? null, error: null };
    return this.rows[0]
      ? { data: this.rows[0], error: null }
      : { data: null, error: { message: "No rows (seed mode)", code: "PGRST116" } };
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

export const seedSupabase = {
  from(table: string): Query {
    return new Query(SEED_TABLES[table] ?? [], table);
  },
  rpc(name: string, args: Record<string, unknown> = {}): PromiseLike<Result> {
    if (!(name in SEED_RPC)) return Promise.resolve({ data: null, error: READ_ONLY });
    const v = SEED_RPC[name];
    return Promise.resolve({ data: typeof v === "function" ? v(args) : v, error: null });
  },
  auth: {
    async getSession() { return { data: { session: null }, error: null }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    async signInWithPassword() { return { data: { user: null, session: null }, error: READ_ONLY }; },
    async signUp() { return { data: { user: null, session: null }, error: READ_ONLY }; },
    async signOut() { return { error: null }; },
  },
  functions: {
    async invoke() { return { data: null, error: READ_ONLY }; },
  },
};
