/**
 * BusinessEvent / BusinessData repository — Vol 4_0 (Business Data
 * Architecture), Vol 11_1 §2-3 (schema).
 *
 * Immutability by design: this module deliberately exposes no update or
 * delete function for a confirmed BusinessEvent. That is the primary
 * enforcement mechanism (an API surface that cannot express the operation);
 * the DB trigger in migrations.ts is defense-in-depth on top of it
 * (Vol 4_0 §7).
 *
 * Sprint 2 scope: manual/text capture only, immediately 'confirmed'.
 * Sprint 3 adds a second, AI-interpreted path (recordCaptureQueued +
 * setBusinessEventStatus/setBusinessDataClassification, used by
 * ai/capturePipeline.ts) that goes through
 * queued -> processing -> draft|needs_clarification -> confirmed before
 * the row becomes immutable — Sprint 3 scoped this to the Expense domain
 * only; Sprint 6 extends it to Sale and Purchase too. Banking stays on the
 * Sprint 2 manual/immediate-confirm path until its own pipeline arrives in
 * Sprint 7 (Vol 0_1 §4).
 */
import type { SqlDb } from "./types";
import { assertSyncGateOk, enqueueSyncableWrite } from "../sync/syncHooks";
import { BUSINESS_EVENTS_IMMUTABLE_TRIGGER_SQL } from "./migrations";

export type CaptureMode = "voice" | "text" | "photo" | "document" | "manual";
export type BusinessEventStatus =
  | "queued"
  | "processing"
  | "needs_clarification"
  | "draft"
  | "confirmed"
  | "superseded";
export type DomainHint =
  "sale" | "purchase" | "expense" | "banking" | "unclassified";
export type BusinessDataType =
  "sale" | "purchase" | "expense" | "bank_transaction";
export type PaymentMethod =
  "cash" | "bank_transfer" | "card" | "other" | "unspecified";

export interface BusinessEvent {
  id: string;
  business_id: string;
  captured_at: string;
  capture_mode: CaptureMode;
  raw_input_ref: string | null;
  status: BusinessEventStatus;
  superseded_by: string | null;
  domain_hint: DomainHint;
}

export interface BusinessData {
  id: string;
  business_event_id: string;
  type: BusinessDataType;
  counterparty_name: string | null;
  amount: number;
  currency: string;
  payment_method: PaymentMethod;
  category_guess: string | null;
  confidence: number | null;
  document_refs: string; // JSON-encoded array; SQLite has no native array type.
  created_at: string;
}

export interface ManualCaptureInput {
  businessId: string;
  domainHint: DomainHint;
  dataType: BusinessDataType;
  description: string;
  counterpartyName?: string;
  amount: number;
  currency: string;
  paymentMethod: PaymentMethod;
}

/**
 * Generates a Business Event id in the Vol 11_1 §2 format: BE-YYYYMMDD-NNNN.
 * NNNN is a per-day sequence, derived from how many events already exist
 * for that date — sufficient for Phase 1's single-device, single-business
 * capture volume.
 */
export async function generateBusinessEventId(
  db: SqlDb,
  date: Date,
): Promise<string> {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const datePart = `${yyyy}${mm}${dd}`;

  const rows = await db.queryAll<{ count: number }>(
    `SELECT COUNT(*) as count FROM business_events WHERE id LIKE ?;`,
    [`BE-${datePart}-%`],
  );
  const nextSeq = (rows[0]?.count ?? 0) + 1;
  const seqPart = String(nextSeq).padStart(4, "0");
  return `BE-${datePart}-${seqPart}`;
}

async function insertEventAndData(
  db: SqlDb,
  params: {
    businessId: string;
    domainHint: DomainHint;
    dataType: BusinessDataType;
    description: string;
    counterpartyName?: string;
    amount: number;
    currency: string;
    paymentMethod: PaymentMethod;
    status: BusinessEventStatus;
  },
): Promise<{ event: BusinessEvent; data: BusinessData }> {
  // Sprint 16 (Vol 12_1 Section 6a.3): checked BEFORE any db.execute below
  // -- a rejected write must never touch the database at all, not be
  // written and then regretted.
  await assertSyncGateOk(db);
  const now = new Date();
  const nowIso = now.toISOString();
  const eventId = await generateBusinessEventId(db, now);
  const dataId = `BD-${eventId.slice(3)}`;

  await db.execute(
    `INSERT INTO business_events
       (id, business_id, captured_at, capture_mode, raw_input_ref, status, superseded_by, domain_hint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      eventId,
      params.businessId,
      nowIso,
      "text",
      params.description,
      params.status,
      null,
      params.domainHint,
    ],
  );

  await db.execute(
    `INSERT INTO business_data
       (id, business_event_id, type, counterparty_name, amount, currency, payment_method, category_guess, confidence, document_refs, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      dataId,
      eventId,
      params.dataType,
      params.counterpartyName ?? null,
      params.amount,
      params.currency,
      params.paymentMethod,
      null,
      null,
      "[]",
      nowIso,
    ],
  );

  // Sprint 16 (Vol 12_1 Section 6.1) -- gated at the boundary every write
  // already passes through, not in the caller. No-op when this device has
  // no sync context set (syncHooks.ts).
  await enqueueSyncableWrite(db, "business_event", "insert", {
    id: eventId,
    business_id: params.businessId,
    captured_at: nowIso,
    capture_mode: "text",
    raw_input_ref: params.description,
    status: params.status,
    superseded_by: null,
    domain_hint: params.domainHint,
  });
  await enqueueSyncableWrite(db, "business_data", "insert", {
    id: dataId,
    business_event_id: eventId,
    type: params.dataType,
    counterparty_name: params.counterpartyName ?? null,
    amount: params.amount,
    currency: params.currency,
    payment_method: params.paymentMethod,
    category_guess: null,
    confidence: null,
    document_refs: "[]",
    created_at: nowIso,
  });

  return {
    event: {
      id: eventId,
      business_id: params.businessId,
      captured_at: nowIso,
      capture_mode: "text",
      raw_input_ref: params.description,
      status: params.status,
      superseded_by: null,
      domain_hint: params.domainHint,
    },
    data: {
      id: dataId,
      business_event_id: eventId,
      type: params.dataType,
      counterparty_name: params.counterpartyName ?? null,
      amount: params.amount,
      currency: params.currency,
      payment_method: params.paymentMethod,
      category_guess: null,
      confidence: null,
      document_refs: "[]",
      created_at: nowIso,
    },
  };
}

/**
 * Records a manually-captured Business Event and its BusinessData in one
 * step, immediately 'confirmed'. Used for domains that have no AI pipeline
 * yet — Banking only, as of Sprint 6 (Sprint 7 adds Banking's pipeline).
 * Expense/Sale/Purchase capture uses recordCaptureQueued instead.
 */
export async function recordManualCapture(
  db: SqlDb,
  input: ManualCaptureInput,
): Promise<{ event: BusinessEvent; data: BusinessData }> {
  return insertEventAndData(db, { ...input, status: "confirmed" });
}

export interface CaptureQueuedInput {
  /** Sprint 6: which AI-interpreted domain this capture belongs to — domain_hint and BusinessData.type both take this value directly (their enums share the "expense" | "sale" | "purchase" values by design). */
  domain: "expense" | "sale" | "purchase";
  businessId: string;
  description: string;
  counterpartyName?: string;
  amount: number;
  currency: string;
  paymentMethod: PaymentMethod;
}

export interface QueuedPhotoEventInput {
  businessId: string;
  /** Only known after extraction/owner entry, so photo events start with no amount/data at all -- see attachExpenseBusinessData. */
}

/**
 * Creates a queued, EVENT-ONLY BusinessEvent for a photo capture (Vol 7_1
 * §2 photo mode) — no BusinessData yet, since amount/category aren't known
 * until vision extraction or the owner's fallback form completes (Vol 7_1
 * §5.1). This is the one legitimate case where an event exists without a
 * data row; every other capture path creates both together
 * (insertEventAndData above).
 */
export async function createQueuedPhotoEvent(
  db: SqlDb,
  input: QueuedPhotoEventInput,
): Promise<BusinessEvent> {
  await assertSyncGateOk(db);
  const now = new Date();
  const nowIso = now.toISOString();
  const eventId = await generateBusinessEventId(db, now);

  await db.execute(
    `INSERT INTO business_events
       (id, business_id, captured_at, capture_mode, raw_input_ref, status, superseded_by, domain_hint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      eventId,
      input.businessId,
      nowIso,
      "photo",
      null,
      "queued",
      null,
      "expense",
    ],
  );

  const event: BusinessEvent = {
    id: eventId,
    business_id: input.businessId,
    captured_at: nowIso,
    capture_mode: "photo",
    raw_input_ref: null,
    status: "queued",
    superseded_by: null,
    domain_hint: "expense",
  };
  await enqueueSyncableWrite(db, "business_event", "insert", event);
  return event;
}

export interface AttachExpenseDataInput {
  eventId: string;
  description: string;
  counterpartyName?: string;
  amount: number;
  currency: string;
  paymentMethod: PaymentMethod;
}

/**
 * Attaches a BusinessData row to an existing (event-only) photo event once
 * its fields are known — either from a 'complete' vision extraction or the
 * owner completing the Vol 7_1 §5.1 fallback form. Also backfills the
 * event's raw_input_ref with the description, since photo events are
 * created without one (there's no text yet at capture time). This is a
 * pre-confirmation write (event status is still 'queued'/'processing' at
 * this point), so it is not blocked by the confirmed-immutability trigger.
 */
export async function attachExpenseBusinessData(
  db: SqlDb,
  input: AttachExpenseDataInput,
): Promise<BusinessData> {
  await assertSyncGateOk(db);
  const nowIso = new Date().toISOString();
  const dataId = `BD-${input.eventId.slice(3)}`;

  await db.execute(
    `UPDATE business_events SET raw_input_ref = ? WHERE id = ?;`,
    [input.description, input.eventId],
  );

  await db.execute(
    `INSERT INTO business_data
       (id, business_event_id, type, counterparty_name, amount, currency, payment_method, category_guess, confidence, document_refs, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      dataId,
      input.eventId,
      "expense",
      input.counterpartyName ?? null,
      input.amount,
      input.currency,
      input.paymentMethod,
      null,
      null,
      "[]",
      nowIso,
    ],
  );

  const data: BusinessData = {
    id: dataId,
    business_event_id: input.eventId,
    type: "expense",
    counterparty_name: input.counterpartyName ?? null,
    amount: input.amount,
    currency: input.currency,
    payment_method: input.paymentMethod,
    category_guess: null,
    confidence: null,
    document_refs: "[]",
    created_at: nowIso,
  };
  // Sprint 16: the raw_input_ref backfill above (business_events UPDATE)
  // is deliberately NOT separately synced -- Vol 12_1 Section 3's op enum
  // has no "update" variant for business_event, only insert/
  // status_transition; a second "insert" would be silently ignored
  // remotely (insert never overwrites, by design). This is a documented,
  // narrow gap specific to the Sprint 5 photo-capture two-phase write,
  // not a general sync limitation -- see the Sprint 16 runbook.
  await enqueueSyncableWrite(db, "business_data", "insert", data);
  return data;
}

/**
 * Records a captured Business Event as 'queued' — not yet confirmed — for
 * any of the three AI-interpreted domains (Sprint 3: expense only; Sprint
 * 6: generalised to sale and purchase too, replacing the former
 * recordExpenseCaptureQueued). ai/capturePipeline.ts drives it through
 * processing -> draft | needs_clarification -> confirmed. Kept in this
 * module (not the pipeline module) because it is a plain data-layer
 * operation, consistent with recordManualCapture above. domain_hint and
 * BusinessData.type both take input.domain directly — the DomainHint and
 * BusinessDataType enums share the same "expense" | "sale" | "purchase"
 * literal values by design, so no per-domain mapping table is needed.
 */
export async function recordCaptureQueued(
  db: SqlDb,
  input: CaptureQueuedInput,
): Promise<{ event: BusinessEvent; data: BusinessData }> {
  return insertEventAndData(db, {
    businessId: input.businessId,
    domainHint: input.domain,
    dataType: input.domain,
    description: input.description,
    counterpartyName: input.counterpartyName,
    amount: input.amount,
    currency: input.currency,
    paymentMethod: input.paymentMethod,
    status: "queued",
  });
}

/**
 * Transitions a BusinessEvent's status. Only valid pre-confirmation (the
 * immutability trigger in migrations.ts blocks any UPDATE once
 * OLD.status = 'confirmed', including this one) — that restriction is the
 * enforcement mechanism, not something checked again here.
 */
export async function setBusinessEventStatus(
  db: SqlDb,
  eventId: string,
  status: BusinessEventStatus,
): Promise<void> {
  await assertSyncGateOk(db);
  await db.execute(`UPDATE business_events SET status = ? WHERE id = ?;`, [
    status,
    eventId,
  ]);
  // Naturally idempotent (re-setting the same status is a no-op UPDATE),
  // so this can be reused as-is for both the local write path and pulled
  // status_transition envelope application (sync/applyEnvelope.ts).
  await enqueueSyncableWrite(
    db,
    "business_event_status_transition",
    "status_transition",
    { eventId, status },
  );
}

/**
 * Persists a classification (category + confidence) onto a BusinessData
 * row. Callers must ensure this runs BEFORE the parent BusinessEvent is
 * set to 'confirmed' — nothing here enforces that ordering, since
 * business_data itself has no immutability trigger; the ordering
 * discipline in ai/expensePipeline.ts is what makes it effectively
 * immutable too. See that module's finalizeExpenseCategory for the
 * invariant this depends on.
 */
export async function setBusinessDataClassification(
  db: SqlDb,
  businessDataId: string,
  categoryGuess: string,
  confidence: number,
): Promise<void> {
  await db.execute(
    `UPDATE business_data SET category_guess = ?, confidence = ? WHERE id = ?;`,
    [categoryGuess, confidence, businessDataId],
  );
}

/**
 * Links an already-confirmed BusinessEvent forward to the correcting event
 * that supersedes it (Vol 4_0 §7). Allowed exactly once by the migration 4
 * trigger — calling this a second time on the same event, or on a
 * non-confirmed event, is rejected at the DB layer, not just here.
 */
export async function setSupersededBy(
  db: SqlDb,
  originalEventId: string,
  correctingEventId: string,
): Promise<void> {
  await assertSyncGateOk(db);
  await db.execute(
    `UPDATE business_events SET superseded_by = ? WHERE id = ?;`,
    [correctingEventId, originalEventId],
  );
  // The migration-4 trigger permits exactly one NULL->value transition,
  // so a replayed envelope for the same (originalEventId,
  // correctingEventId) pair is a safe no-op UPDATE (identical values);
  // a genuinely conflicting second supersede is rejected by the trigger,
  // not by this function -- see applyEnvelope.ts for how that surfaces.
  await enqueueSyncableWrite(
    db,
    "business_event_status_transition",
    "status_transition",
    { originalEventId, correctingEventId },
  );
}

/**
 * Sprint 20 (Vol 12_1 Section 7.2) — a privileged, narrowly-scoped
 * override used ONLY by sync/reconciliation.ts's offline-demoted-device
 * backstop. Never call this from a normal write path.
 *
 * Why it has to exist: the migration-4 trigger (see
 * BUSINESS_EVENTS_IMMUTABLE_TRIGGER_SQL) permits exactly one
 * NULL->value superseded_by transition and explicitly forbids
 * un-superseding. That is exactly right for every ordinary write path --
 * but Section 7.2's backstop case needs one deliberate exception: a
 * device that captured a correction offline, unaware it had been
 * demoted, may have already applied ITS OWN correction locally (a
 * legitimate NULL->value transition at the time, on that device) before
 * ever learning that a DIFFERENT device's competing correction reached
 * the server first and is the one that must canonically stand. That
 * device's local row is left pointing at the losing correction, and the
 * trigger (correctly, by its own rules) then refuses to let the
 * winning, pulled transition overwrite it -- see applyEnvelope.ts's
 * comment on exactly this rejection.
 *
 * The fix is not to weaken the trigger (every normal write path still
 * needs its guarantee) -- it is to let the reconciliation path, and only
 * that path, un-supersede the one row it has already independently
 * proven is this device's own not-yet-pushed losing write (never a
 * pulled/server-confirmed one), so it can then reapply the correct
 * winning transition through the SAME trigger-enforced path every other
 * device uses. Scoped to a single row, single call, immediately
 * followed by trigger restoration in a finally block so no other write
 * anywhere in the app can ever run while the trigger is down.
 */
export async function forceResetSupersededByForReconciliation(
  db: SqlDb,
  eventId: string,
  newValue: string | null,
): Promise<void> {
  await db.execute(`DROP TRIGGER IF EXISTS business_events_immutable_once_confirmed;`);
  try {
    await db.execute(`UPDATE business_events SET superseded_by = ? WHERE id = ?;`, [
      newValue,
      eventId,
    ]);
  } finally {
    await db.execute(BUSINESS_EVENTS_IMMUTABLE_TRIGGER_SQL);
  }
}

/**
 * Sprint 20 — the correcting BusinessData row for a given BusinessEvent
 * id (a correction always has exactly one, per capturePipeline.ts's
 * correctConfirmedCapture). Used by sync/reconciliation.ts to find the
 * rows that must be deleted alongside a discarded losing correction.
 */
export async function getBusinessDataByEventId(
  db: SqlDb,
  eventId: string,
): Promise<BusinessData | null> {
  const rows = await db.queryAll<BusinessData>(
    `SELECT * FROM business_data WHERE business_event_id = ? LIMIT 1;`,
    [eventId],
  );
  return rows[0] ?? null;
}

/**
 * Sprint 20 — deletes a discarded correction's BusinessEvent + BusinessData
 * rows. Only ever called by sync/reconciliation.ts, and only on a
 * correction bundle that (a) lost Section 7.2's backstop conflict and
 * (b) was NEVER pushed (still sitting, at time of call, in this device's
 * own outbox) -- so this is deleting purely local, not-yet-shared data,
 * never anything another device could already have. Ledger entries are
 * handled separately by ledgerRepository.deleteLedgerEntriesForBusinessData
 * (reconciliation.ts calls both, in the right order for FK-shaped data
 * even though this schema has no formal FK constraints).
 */
export async function deleteDiscardedCorrectionEventAndData(
  db: SqlDb,
  eventId: string,
  dataId: string,
): Promise<void> {
  await db.execute(`DELETE FROM business_data WHERE id = ?;`, [dataId]);
  await db.execute(`DELETE FROM business_events WHERE id = ?;`, [eventId]);
}

export interface RecentActivityItem {
  event: BusinessEvent;
  data: BusinessData;
  /**
   * Denormalised from the latest ai_interpretations row for this event, if
   * any (Sprint 3). Lets the UI show the clarifying question or reasoning
   * without a second query per row.
   */
  latestInterpretation: {
    clarifyingQuestion: string | null;
    reasoning: string | null;
  } | null;
}

function rowToActivityItem(
  row: BusinessEvent &
    BusinessData & {
      data_id: string;
      data_created_at: string;
      latest_clarifying_question: string | null;
      latest_reasoning: string | null;
    },
): RecentActivityItem {
  return {
    event: {
      id: row.id,
      business_id: row.business_id,
      captured_at: row.captured_at,
      capture_mode: row.capture_mode,
      raw_input_ref: row.raw_input_ref,
      status: row.status,
      superseded_by: row.superseded_by,
      domain_hint: row.domain_hint,
    },
    data: {
      id: row.data_id,
      business_event_id: row.id,
      type: row.type,
      counterparty_name: row.counterparty_name,
      amount: row.amount,
      currency: row.currency,
      payment_method: row.payment_method,
      category_guess: row.category_guess,
      confidence: row.confidence,
      document_refs: row.document_refs,
      created_at: row.data_created_at,
    },
    latestInterpretation:
      row.latest_clarifying_question != null || row.latest_reasoning != null
        ? {
            clarifyingQuestion: row.latest_clarifying_question,
            reasoning: row.latest_reasoning,
          }
        : null,
  };
}

const ACTIVITY_SELECT = `
     SELECT
       be.id as id, be.business_id as business_id, be.captured_at as captured_at,
       be.capture_mode as capture_mode, be.raw_input_ref as raw_input_ref,
       be.status as status, be.superseded_by as superseded_by, be.domain_hint as domain_hint,
       bd.id as data_id, bd.type as type, bd.counterparty_name as counterparty_name,
       bd.amount as amount, bd.currency as currency, bd.payment_method as payment_method,
       bd.category_guess as category_guess, bd.confidence as confidence,
       bd.document_refs as document_refs, bd.created_at as data_created_at,
       (SELECT ai.clarifying_question FROM ai_interpretations ai
          WHERE ai.business_event_id = be.id
          ORDER BY ai.requested_at DESC LIMIT 1) as latest_clarifying_question,
       (SELECT ai.reasoning FROM ai_interpretations ai
          WHERE ai.business_event_id = be.id
          ORDER BY ai.requested_at DESC LIMIT 1) as latest_reasoning
     FROM business_events be
     JOIN business_data bd ON bd.business_event_id = be.id`;

/**
 * Reverse-chronological Business Events with their linked BusinessData —
 * backs the Sprint 2 activity feed (Vol 7_1 minimal feed; upgraded into
 * the full dashboard in Sprint 4).
 */
export async function listRecentActivity(
  db: SqlDb,
  businessId: string,
  limit = 50,
): Promise<RecentActivityItem[]> {
  const rows = await db.queryAll<
    BusinessEvent &
      BusinessData & {
        data_id: string;
        data_created_at: string;
        latest_clarifying_question: string | null;
        latest_reasoning: string | null;
      }
  >(
    `${ACTIVITY_SELECT}
     WHERE be.business_id = ?
     -- id is a secondary sort key because captured_at (millisecond ISO)
     -- can tie under rapid successive captures; the per-day sequence
     -- embedded in the id (Vol 11_1 Section 2) breaks ties deterministically.
     ORDER BY be.captured_at DESC, be.id DESC
     LIMIT ?;`,
    [businessId, limit],
  );

  return rows.map(rowToActivityItem);
}

/**
 * Sprint 9 — fetches a raw BusinessEvent row with no BusinessData join, so
 * it also returns for an event that doesn't have one yet (a queued photo
 * capture whose extraction never ran). `getActivityItemByEventId` below
 * INNER JOINs business_data and would return null for exactly that case,
 * which is why `resumeQueuedPhotoCaptures` (ai/capturePipeline.ts) needs
 * this instead.
 */
export async function getBusinessEventById(
  db: SqlDb,
  eventId: string,
): Promise<BusinessEvent | null> {
  const rows = await db.queryAll<BusinessEvent>(
    `SELECT * FROM business_events WHERE id = ? LIMIT 1;`,
    [eventId],
  );
  return rows[0] ?? null;
}

/**
 * Fetches a single Business Event + BusinessData pair by event id — used by
 * the Capture screen to re-render a queued/processing/draft/
 * needs_clarification event as its AI interpretation resolves, and by
 * confirmExpenseCategory's caller to get amount/currency/payment_method
 * without re-deriving them.
 */
export async function getActivityItemByEventId(
  db: SqlDb,
  eventId: string,
): Promise<RecentActivityItem | null> {
  const rows = await db.queryAll<
    BusinessEvent &
      BusinessData & {
        data_id: string;
        data_created_at: string;
        latest_clarifying_question: string | null;
        latest_reasoning: string | null;
      }
  >(`${ACTIVITY_SELECT} WHERE be.id = ? LIMIT 1;`, [eventId]);
  return rows[0] ? rowToActivityItem(rows[0]) : null;
}

/**
 * Sprint 16 — applies a pulled `business_event` insert envelope (Vol 12_1
 * Section 6.2/6.3). Unlike insertEventAndData, the id here was already
 * assigned by the originating device (it travelled inside the envelope),
 * so this cannot go through generateBusinessEventId; INSERT OR IGNORE
 * makes re-delivery of the same envelope a safe no-op, satisfying Section
 * 6.3's idempotency requirement on the pull side the same way
 * ledgerRepository's deterministic ids already do on tables that mint
 * their own id.
 */
export async function applyPulledBusinessEvent(
  db: SqlDb,
  event: BusinessEvent,
): Promise<void> {
  await db.execute(
    `INSERT OR IGNORE INTO business_events
       (id, business_id, captured_at, capture_mode, raw_input_ref, status, superseded_by, domain_hint)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      event.id,
      event.business_id,
      event.captured_at,
      event.capture_mode,
      event.raw_input_ref,
      event.status,
      event.superseded_by,
      event.domain_hint,
    ],
  );
}

/** Sprint 16 — applies a pulled `business_data` insert envelope. Same idempotency reasoning as applyPulledBusinessEvent. */
export async function applyPulledBusinessData(
  db: SqlDb,
  data: BusinessData,
): Promise<void> {
  await db.execute(
    `INSERT OR IGNORE INTO business_data
       (id, business_event_id, type, counterparty_name, amount, currency, payment_method, category_guess, confidence, document_refs, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      data.id,
      data.business_event_id,
      data.type,
      data.counterparty_name,
      data.amount,
      data.currency,
      data.payment_method,
      data.category_guess,
      data.confidence,
      data.document_refs,
      data.created_at,
    ],
  );
}
