/**
 * Migration definitions — Vol 11_1 (MVP Data Schema).
 *
 * Pure SQL, no op-sqlite dependency, so these are testable directly
 * (see db/__tests__/migrations.test.ts) and reusable by any SqlDb adapter.
 *
 * Every migration is additive and numbered. Never edit a shipped migration —
 * add a new one. This mirrors the immutability discipline applied to
 * BusinessEvent itself (Vol 4_0 §7).
 */
import type { SqlDb } from "./types";

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

/**
 * Migration 4's trigger DDL, factored out to a named export — Sprint 20
 * (Vol 12_1 Section 7.2). The migration below still owns the shipped
 * behaviour (never edited, per this file's own discipline); this constant
 * exists purely so sync/reconciliation.ts's privileged
 * drop-update-recreate override (used ONLY to correct a demoted device's
 * own premature local superseded_by write, Section 7.2's backstop case)
 * reproduces the EXACT current trigger rather than a hand-copied,
 * driftable second copy of this DDL.
 */
export const BUSINESS_EVENTS_IMMUTABLE_TRIGGER_SQL = `CREATE TRIGGER business_events_immutable_once_confirmed
         BEFORE UPDATE ON business_events
         WHEN OLD.status = 'confirmed'
           AND NOT (
             NEW.id = OLD.id
             AND NEW.business_id = OLD.business_id
             AND NEW.captured_at = OLD.captured_at
             AND NEW.capture_mode = OLD.capture_mode
             AND NEW.raw_input_ref IS OLD.raw_input_ref
             AND NEW.status = OLD.status
             AND NEW.domain_hint = OLD.domain_hint
             AND OLD.superseded_by IS NULL
             AND NEW.superseded_by IS NOT NULL
           )
       BEGIN
         SELECT RAISE(ABORT, 'BusinessEvent rows are immutable once confirmed, except for a single one-time superseded_by linkage (Vol 4_0 Section 7).');
       END;`;

export const migrations: Migration[] = [
  {
    version: 1,
    name: "init_schema_version_table",
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version INTEGER PRIMARY KEY,
         name TEXT NOT NULL,
         applied_at TEXT NOT NULL DEFAULT (datetime('now'))
       );`,
    ],
  },
  {
    // Sprint 2 — Vol 11_1 §2 (BusinessEvent) and §3 (BusinessData).
    version: 2,
    name: "business_event_and_business_data",
    statements: [
      `CREATE TABLE IF NOT EXISTS business_events (
         id TEXT PRIMARY KEY,
         business_id TEXT NOT NULL,
         captured_at TEXT NOT NULL,
         capture_mode TEXT NOT NULL CHECK (capture_mode IN ('voice','text','photo','document','manual')),
         raw_input_ref TEXT,
         status TEXT NOT NULL CHECK (status IN ('queued','processing','needs_clarification','confirmed','superseded')),
         superseded_by TEXT,
         domain_hint TEXT NOT NULL CHECK (domain_hint IN ('sale','purchase','expense','banking','unclassified'))
       );`,
      // Immutability enforcement (Vol 4_0 §7): once a Business Event reaches
      // 'confirmed', no field on that row may change — corrections must be a
      // new, separately-created superseding event instead. This trigger is
      // the "structurally impossible" mechanism the Sprint 2 Definition of
      // Done calls for; it is intentionally scoped to OLD.status = 'confirmed'
      // rather than blocking all updates, so pre-confirmation status
      // transitions (queued -> processing -> confirmed) that Sprint 3's async
      // AI interpretation needs remain possible.
      `CREATE TRIGGER IF NOT EXISTS business_events_immutable_once_confirmed
         BEFORE UPDATE ON business_events
         WHEN OLD.status = 'confirmed'
       BEGIN
         SELECT RAISE(ABORT, 'BusinessEvent rows are immutable once confirmed; insert a new superseding event instead (Vol 4_0 Section 7).');
       END;`,
      `CREATE TABLE IF NOT EXISTS business_data (
         id TEXT PRIMARY KEY,
         business_event_id TEXT NOT NULL REFERENCES business_events(id),
         type TEXT NOT NULL CHECK (type IN ('sale','purchase','expense','bank_transaction')),
         counterparty_name TEXT,
         amount REAL NOT NULL,
         currency TEXT NOT NULL,
         payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','bank_transfer','card','other','unspecified')),
         category_guess TEXT,
         confidence REAL,
         document_refs TEXT NOT NULL DEFAULT '[]',
         created_at TEXT NOT NULL
       );`,
      `CREATE INDEX IF NOT EXISTS idx_business_data_event_id ON business_data(business_event_id);`,
    ],
  },
  {
    // Sprint 3 — Vol 2_2 §4.1 (confidence routing needs a third, non-final
    // state between "AI produced a guess" and "owner confirmed it") and
    // Vol 11_1 §4 (LedgerEntry) + explainability (Vol 5_3 / Sprint 3 DoD).
    version: 3,
    name: "expense_interpretation_pipeline",
    statements: [
      // SQLite cannot ALTER a CHECK constraint in place, so widening the
      // BusinessEvent.status enum to add 'draft' (the 60-89% confidence
      // band — recorded but awaiting a one-tap owner confirm, distinct from
      // both 'processing' and 'needs_clarification') requires the standard
      // SQLite rebuild-and-rename pattern. Data is preserved; the
      // immutability trigger is recreated on the new table afterward.
      `CREATE TABLE business_events_v3 (
         id TEXT PRIMARY KEY,
         business_id TEXT NOT NULL,
         captured_at TEXT NOT NULL,
         capture_mode TEXT NOT NULL CHECK (capture_mode IN ('voice','text','photo','document','manual')),
         raw_input_ref TEXT,
         status TEXT NOT NULL CHECK (status IN ('queued','processing','needs_clarification','draft','confirmed','superseded')),
         superseded_by TEXT,
         domain_hint TEXT NOT NULL CHECK (domain_hint IN ('sale','purchase','expense','banking','unclassified'))
       );`,
      `INSERT INTO business_events_v3
         (id, business_id, captured_at, capture_mode, raw_input_ref, status, superseded_by, domain_hint)
       SELECT id, business_id, captured_at, capture_mode, raw_input_ref, status, superseded_by, domain_hint
       FROM business_events;`,
      `DROP TABLE business_events;`,
      `ALTER TABLE business_events_v3 RENAME TO business_events;`,
      `CREATE TRIGGER IF NOT EXISTS business_events_immutable_once_confirmed
         BEFORE UPDATE ON business_events
         WHEN OLD.status = 'confirmed'
       BEGIN
         SELECT RAISE(ABORT, 'BusinessEvent rows are immutable once confirmed; insert a new superseding event instead (Vol 4_0 Section 7).');
       END;`,
      // LedgerEntry — Vol 11_1 §4. Phase 1 minimal form: no full GL engine,
      // just an auditable record of money movement per account bucket.
      `CREATE TABLE IF NOT EXISTS ledger_entries (
         id TEXT PRIMARY KEY,
         business_data_id TEXT NOT NULL REFERENCES business_data(id),
         account TEXT NOT NULL,
         direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
         amount REAL NOT NULL,
         currency TEXT NOT NULL,
         posted_at TEXT NOT NULL,
         reversal_of TEXT
       );`,
      `CREATE INDEX IF NOT EXISTS idx_ledger_entries_business_data_id ON ledger_entries(business_data_id);`,
      // AI interpretation record — not itself named as a schema in Vol 11_1,
      // but required to satisfy two explicit Sprint 3 Definition of Done
      // items: "every AI decision has a traceable source_reference
      // persisted" and "cost-per-event is measured and logged" (Vol 5_3
      // explainability principle, made concrete here).
      `CREATE TABLE IF NOT EXISTS ai_interpretations (
         id TEXT PRIMARY KEY,
         business_event_id TEXT NOT NULL REFERENCES business_events(id),
         business_data_id TEXT NOT NULL REFERENCES business_data(id),
         requested_at TEXT NOT NULL,
         model TEXT NOT NULL,
         decision TEXT NOT NULL CHECK (decision IN ('auto_record','draft_confirm','clarify')),
         category TEXT,
         confidence REAL NOT NULL,
         reasoning TEXT NOT NULL,
         clarifying_question TEXT,
         matched_rule_ids TEXT NOT NULL DEFAULT '[]',
         source_references TEXT NOT NULL DEFAULT '[]',
         pka_version TEXT NOT NULL,
         latency_ms INTEGER NOT NULL,
         estimated_cost_usd REAL
       );`,
      `CREATE INDEX IF NOT EXISTS idx_ai_interpretations_event_id ON ai_interpretations(business_event_id);`,
    ],
  },
  {
    // Sprint 4 — Vol 4_0 §7 documents that a correction "creates a new
    // event with superseded_by pointing forward" on the ORIGINAL
    // (now-confirmed) event. Migration 2's trigger blocks every update
    // once a row is confirmed, including that one documented transition —
    // a real gap, not exercised until Sprint 4 needed post-confirmation
    // correction (Vol 4_1 §4 reversal-based correction). This migration
    // replaces the trigger with one that permits exactly one additional
    // write: setting superseded_by from NULL to a value, with every other
    // column required to stay identical. It still rejects everything else
    // (a second supersede, un-superseding, or any other field edit).
    version: 4,
    name: "allow_superseded_by_linkage_on_confirmed_events",
    statements: [
      `DROP TRIGGER IF EXISTS business_events_immutable_once_confirmed;`,
      BUSINESS_EVENTS_IMMUTABLE_TRIGGER_SQL,
    ],
  },
  {
    // Sprint 5 — Vol 11_1 §5 (Document). document_blobs stores the actual
    // image bytes as a BLOB column *inside this SQLCipher-encrypted
    // database* rather than as loose files on the filesystem. This is a
    // deliberate Phase 1 design choice, not an oversight: Vol 11_0 §3 asks
    // for "encrypted local file storage" for receipt images, and the
    // straightforward way to do that in React Native would be a new
    // file-encryption dependency (e.g. AES via a native crypto library) --
    // but AGENTS.md requires approval before adding new production
    // dependencies, and op-sqlite + SQLCipher already gives the whole
    // database file (including BLOB columns) at-rest encryption for free.
    // Storing images as BLOBs reuses that guarantee with zero new
    // dependencies. Revisit if image volume/size ever makes SQLite BLOB
    // storage impractical (Vol 11_0's own "Revisit If" column already
    // anticipates this general shape of tradeoff).
    version: 5,
    name: "documents_and_document_blobs",
    statements: [
      `CREATE TABLE IF NOT EXISTS documents (
         id TEXT PRIMARY KEY,
         business_event_id TEXT NOT NULL REFERENCES business_events(id),
         file_ref TEXT NOT NULL,
         type TEXT NOT NULL CHECK (type IN ('receipt','invoice','statement','other')),
         extraction_status TEXT NOT NULL CHECK (extraction_status IN ('not_attempted','partial','complete','failed')),
         created_at TEXT NOT NULL
       );`,
      `CREATE INDEX IF NOT EXISTS idx_documents_event_id ON documents(business_event_id);`,
      // file_ref on the documents row above is this table's id (1:1). Kept
      // as a separate table, not an extra column on `documents`, so a
      // future "loose encrypted file" storage backend could be swapped in
      // without changing the documents table's own schema -- file_ref
      // would just point somewhere else.
      `CREATE TABLE IF NOT EXISTS document_blobs (
         id TEXT PRIMARY KEY,
         mime_type TEXT NOT NULL,
         base64_data TEXT NOT NULL,
         byte_size INTEGER NOT NULL,
         created_at TEXT NOT NULL
       );`,
    ],
  },
  {
    // Sprint 7 — Vol 6_4 §4 (Reconciliation as a first-class flow).
    // Records that a Banking BusinessEvent (Deposit/Withdrawal) was
    // matched against — and fully settles — an existing outstanding
    // receivable/payable's BusinessData row. The settlement's own ledger
    // effect (crediting Accounts Receivable/debiting Accounts Payable,
    // debiting/crediting Cash/Bank) is posted as ordinary ledger_entries
    // rows against that SAME matched_business_data_id (see
    // bankingRepository.ts) — this table exists purely for audit
    // traceability ("which bank transaction settled this invoice/bill"),
    // not to compute the balance itself; getOutstandingReceivables/
    // getOutstandingPayables (Sprint 6) already net correctly from
    // ledger_entries alone with no query changes needed.
    version: 6,
    name: "bank_reconciliations",
    statements: [
      `CREATE TABLE IF NOT EXISTS bank_reconciliations (
         id TEXT PRIMARY KEY,
         bank_event_id TEXT NOT NULL REFERENCES business_events(id),
         matched_business_data_id TEXT NOT NULL REFERENCES business_data(id),
         matched_at TEXT NOT NULL
       );`,
      `CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_matched_data ON bank_reconciliations(matched_business_data_id);`,
      `CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_bank_event ON bank_reconciliations(bank_event_id);`,
    ],
  },
  {
    // Sprint 8 -- Business Knowledge Store, Phase 1 minimal form (Vol 4_2
    // §3.1, Vol 11_1 §7). One table, one heuristic (vendor -> category
    // mapping) -- not a general-purpose pattern engine. `key` is the raw
    // vendor/counterparty name as captured; `value` is the category it has
    // most recently been confirmed against; `confirmation_count` tracks a
    // CONSECUTIVE streak of the same value (a differing confirmation
    // resets it to 1, see businessKnowledgeRepository.ts) and only crosses
    // "trusted" at TRUSTED_CONFIRMATION_THRESHOLD (3). The id is
    // deterministic per (business_id, pattern_type, key) so a repeat
    // vendor always resolves to the same row rather than accumulating
    // duplicates.
    version: 7,
    name: "business_knowledge_entries",
    statements: [
      `CREATE TABLE IF NOT EXISTS business_knowledge_entries (
         id TEXT PRIMARY KEY,
         business_id TEXT NOT NULL,
         pattern_type TEXT NOT NULL CHECK (pattern_type IN ('vendor_category_mapping', 'customer_payment_behaviour', 'other')),
         key TEXT NOT NULL,
         value TEXT NOT NULL,
         confirmation_count INTEGER NOT NULL DEFAULT 1,
         confirmed_at TEXT NOT NULL
       );`,
      `CREATE INDEX IF NOT EXISTS idx_bke_business_pattern ON business_knowledge_entries(business_id, pattern_type);`,
    ],
  },
  {
    // Sprint 10 -- Settings & Business Configuration, Phase 1 basic (Vol
    // 7_7). Single row per business (Phase 1 is single-business per
    // device, same assumption db/client.ts's getLocalBusinessId already
    // makes). SQLite has no native boolean type; the *_enabled/notify_*
    // columns are INTEGER 0/1 by convention, read/written as JS booleans
    // by appSettingsRepository.ts -- never compared against 0/1 literals
    // outside that one module.
    version: 8,
    name: "app_settings",
    statements: [
      `CREATE TABLE IF NOT EXISTS app_settings (
         business_id TEXT PRIMARY KEY,
         business_name TEXT,
         industry TEXT,
         quiet_hours_enabled INTEGER NOT NULL DEFAULT 1,
         quiet_hours_start_hour INTEGER NOT NULL DEFAULT 21,
         quiet_hours_end_hour INTEGER NOT NULL DEFAULT 8,
         notify_action_needed INTEGER NOT NULL DEFAULT 1,
         notify_confirmation_request INTEGER NOT NULL DEFAULT 1,
         updated_at TEXT NOT NULL
       );`,
    ],
  },
  {
    // Sprint 11 -- minimal Observability (Vol 8_6 Section 2-3): local,
    // dependency-free crash/error visibility. No remote crash-reporting
    // SaaS (e.g. Sentry) is integrated -- that would be a new production
    // dependency plus a third-party account/data-sharing decision, neither
    // of which is this codebase's call to make unilaterally (AGENTS.md).
    // This table is Phase 1's "basic crash reporting and API error
    // logging" (Vol 11_0 Section 5's own phrasing) -- captured on-device,
    // surfaced to the owner via the Settings Diagnostics section
    // (errorLogRepository.ts, diagnosticsRepository.ts), and readable by
    // whoever has the device during development/pilot support. Per Vol
    // 8_6 Section 3, this deliberately logs operational signals (an error
    // message/stack/small context object) only -- never raw business
    // content like amounts or counterparty names.
    version: 9,
    name: "app_error_log",
    statements: [
      `CREATE TABLE IF NOT EXISTS app_error_log (
         id TEXT PRIMARY KEY,
         occurred_at TEXT NOT NULL,
         error_type TEXT NOT NULL CHECK (error_type IN ('unhandled_exception','ai_call_error','workspace_call_error')),
         message TEXT NOT NULL,
         stack TEXT,
         context TEXT
       );`,
      `CREATE INDEX IF NOT EXISTS idx_app_error_log_occurred_at ON app_error_log(occurred_at);`,
    ],
  },
  {
    // Sprint 11 -- owner-facing diagnostics (Vol 8_6 Section 4: "last
    // backup time" is one of exactly three things that view shows). No
    // Phase 1 table previously recorded when a backup last succeeded --
    // backupService.ts's uploadBackup only ever wrote to the remote
    // `public.backups` table (Sprint 9), nothing local. A plain
    // `ALTER TABLE ADD COLUMN` is sufficient here (unlike migration 3's
    // CHECK-constraint change, which needed a full table rebuild) since
    // this is an unconstrained nullable column.
    version: 10,
    name: "app_settings_last_backup_at",
    statements: [`ALTER TABLE app_settings ADD COLUMN last_backup_at TEXT;`],
  },
  {
    // Sprint 16 -- Mobile Sync Client & Read-Only Enforcement (Vol 12_1
    // Section 3 Sync Envelope, Section 6 Sync Flow, Section 6a.3 write
    // gate). Purely local bookkeeping tables -- none of this is synced
    // itself, it is the machinery that drives syncing everything else.
    //
    // sync_outbox: local queue of envelopes captured on this device,
    // waiting to be pushed (Section 6.1). A row's presence means "not yet
    // acknowledged by the server"; the row is deleted once push succeeds
    // (Section 6.1: "Device marks the outbox row synced and removes it").
    // payload_ciphertext/payload_iv are stored as base64 TEXT rather than
    // BLOB so the same column shape works identically across every SqlDb
    // adapter this project uses (op-sqlite in production, node:sqlite in
    // tests) without relying on either one's binary-parameter binding
    // behaviour being identical.
    //
    // sync_local_state: one row per business, this device's own sync
    // bookkeeping -- device_id (stable per install), next_device_seq (the
    // monotonic local counter Section 3's envelope_id needs -- kept here,
    // not derived from MAX(device_seq) in sync_outbox, because outbox rows
    // are deleted after push and would make the counter regress), and
    // last_applied_server_seq (this device's pull checkpoint, Section
    // 6.2).
    //
    // sync_lock_cache: this device's last-known copy of
    // public.active_device_lock (Section 5a), refreshed on every pull
    // cycle (Section 6.2's "On receipt of an active_device_lock change").
    // This is what the write gate (sync/writeGate.ts) checks against --
    // Section 6a.3 requires the check to be live/re-checked, not a
    // one-time flag, but it does not require a network round-trip on
    // every keystroke either; re-checking against a cache that is itself
    // kept current by the ordinary pull cycle satisfies both.
    version: 11,
    name: "sync_outbox_and_local_sync_state",
    statements: [
      `CREATE TABLE IF NOT EXISTS sync_outbox (
         envelope_id TEXT PRIMARY KEY,
         business_id TEXT NOT NULL,
         device_id TEXT NOT NULL,
         device_seq INTEGER NOT NULL,
         entity_type TEXT NOT NULL CHECK (entity_type IN (
           'business_event','business_data','ledger_entry','document',
           'ai_interpretation','business_event_status_transition',
           'business_knowledge_entry','app_settings'
         )),
         op TEXT NOT NULL CHECK (op IN ('insert','status_transition','upsert')),
         payload_ciphertext TEXT NOT NULL,
         payload_iv TEXT NOT NULL,
         created_at TEXT NOT NULL,
         -- Section 6a.4's offline-demoted-device backstop needs to tell
         -- the owner "captured before this device was deactivated" --
         -- recorded at enqueue time (the active device this write
         -- believed it was), not derived later, since by the time the
         -- device discovers it was demoted the honest answer is only
         -- knowable from what was true when the write happened.
         written_as_active_device_id TEXT
       );`,
      `CREATE INDEX IF NOT EXISTS idx_sync_outbox_business ON sync_outbox(business_id, device_seq);`,
      `CREATE TABLE IF NOT EXISTS sync_local_state (
         business_id TEXT PRIMARY KEY,
         device_id TEXT NOT NULL,
         next_device_seq INTEGER NOT NULL DEFAULT 1,
         last_applied_server_seq INTEGER NOT NULL DEFAULT 0
       );`,
      `CREATE TABLE IF NOT EXISTS sync_lock_cache (
         business_id TEXT PRIMARY KEY,
         active_device_id TEXT NOT NULL,
         lock_token TEXT NOT NULL,
         acquired_at TEXT NOT NULL,
         cached_at TEXT NOT NULL
       );`,
    ],
  },
];

/**
 * Whether a migration version has already been recorded. Guards against
 * re-running a migration's statements on every app launch (harmless for
 * Sprint 1-2's idempotent CREATE-IF-NOT-EXISTS statements, but Sprint 3's
 * migration 3 does a table rebuild — see its comment above — that must
 * only ever run once). Returns false (not applied) if schema_migrations
 * itself doesn't exist yet, which is the expected state before migration 1
 * has ever run.
 */
async function isMigrationApplied(
  db: SqlDb,
  version: number,
): Promise<boolean> {
  try {
    const rows = await db.queryAll<{ version: number }>(
      `SELECT version FROM schema_migrations WHERE version = ?;`,
      [version],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function runMigrations(db: SqlDb): Promise<void> {
  for (const migration of migrations) {
    if (await isMigrationApplied(db, migration.version)) continue;

    for (const statement of migration.statements) {
      await db.execute(statement);
    }
    await db.execute(
      `INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?);`,
      [migration.version, migration.name],
    );
  }
}
