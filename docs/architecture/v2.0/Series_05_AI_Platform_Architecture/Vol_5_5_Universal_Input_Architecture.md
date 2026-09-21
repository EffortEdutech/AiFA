# AIFA — Universal Input & Channel Router Architecture
## Volume 5_5 — Series 5: AI Platform Architecture — Version 2.0

**Status:** Largely shipped, PARTIAL (16 September 2026, Sprint 62 close-out) —
no longer "target architecture, not yet built." The router (Section 4),
channel adapters (Section 5, minus mobile share-target which remains Sprint
56's own open item), the Channel Intake shape (Section 6), domain
classification across the full ~14-domain list (Section 7), two-dimensional
channel × domain confidence/trust routing (Section 8), and post-approval
chaining without a bespoke orchestrator (Section 9) are all built and SQL-
verified against the real Supabase project across Sprints 53, 57-61. What
remains genuinely open, not silently declared resolved: full live
verification of the channel × domain matrix through the real app UI, and a
real owner-run pilot forwarding an actual WhatsApp message and email on a
real device (Sprint 62's own two open DoD items — see
`Checklist_Master.md`'s Phase 5 Exit Criteria); Section 10's step 3 (mobile
share-target registration, Sprint 56) is not yet started; and Section 11's
own named exclusions (unattended inbound intake, sender-authenticity
verification) remain deliberately out of scope by design, not gaps.
**Operationalises:** Vol 10_5 §2, "One Input. AI Does the Rest." — this volume is that promise's concrete engineering plan, not a restatement of it.
**Owner decision (this revision):** email and WhatsApp are **user-forwarded**, not directly inbound. The logged-in owner receives a message on their own phone/inbox and forwards or shares it into AiFA from inside their own authenticated session — AiFA never listens on a public WhatsApp Business number or a public mailbox. This removes the external-account, Meta-review, and sender-verification burden Section 5 originally described, in exchange for one constraint: nothing reaches AiFA that the owner did not personally choose to forward. See Section 5 for the resulting design.

---

## 1. Purpose

Vol 4_0 §3 already defines the Business Event Layer as receiving "raw input (voice, text, image, PDF, message, import)" — that scope was written into the architecture from the start. What Phase 1-4 actually built is narrower: two channels (in-app text, in-app photo), reachable only through the app's own forms, covering three domains (expense, sale, purchase). This volume closes that gap. It defines a **Universal Input Router**: one front door that accepts any of several channels a solopreneur actually receives business input through, verifies who sent it, classifies what it is, and hands it to the same classify-route-record core every capture already goes through — so adding a channel never means adding a second pipeline.

This is a target architecture. Section 3 states plainly what already exists versus what does not.

## 2. The Problem With Treating Channels as Features

The natural instinct is to build "WhatsApp support," then separately "email support," then separately "a PO screen" — each as its own feature with its own parsing logic, its own confidence rules, its own approval wiring. That produces N pipelines that drift apart and N times the review burden. Vol 6_0 §4's rule ("shared engine, domain-scoped rules") already prevented this for expense/sale/purchase; this volume extends the same discipline one layer up, to the channel a business owner uses to reach that engine at all.

The fix is to separate two concerns that are easy to fuse by accident:

- **Channel** — how the input physically arrived (typed in-app, a photo, a forwarded email, a forwarded WhatsApp message). A channel's only job is to confirm it arrived inside an authenticated session and normalise whatever it received into one common shape.
- **Domain** — what the input is about (an expense, a leave application, a purchase order). A domain's job is to classify, extract fields, decide confidence, and route to the correct record.

Every channel feeds every domain through the same intake shape. Adding a fourth channel does not touch domain logic; adding a fourth domain does not touch channel logic.

## 3. Current Reality (Phase 1-4)

| Layer | What exists today | Evidence |
|---|---|---|
| Channels | In-app typed capture; in-app photo capture. Both call the same `classifyAndRoute` core. | `packages/core/src/ai/capturePipeline.ts` — `runCaptureInterpretation` (text), `runExpensePhotoInterpretation` (photo) |
| Domains | Expense, Sale, Purchase — one shared `BusinessDomain` type, one shared confidence-routing table | `packages/core/src/ai/types.ts`; `pka/accounting_rules.json` |
| AI call | Real: a vision-capable Claude call for photo capture (`packages/core/src/ai/providers/anthropicProvider.ts`) | Not a stub — confirmed live this sprint |
| Confidence routing | Real, three-way: `auto_record` (posts to the ledger immediately), `draft_confirm` (one-tap human confirm), `clarify` (AI asks a specific question rather than guessing) | `capturePipeline.ts` header comment, Vol 2_2 §4.1 |
| Approval engine | Real and generic: `create_approval_task` / `decide_approval_task` RPCs, used today by Leave, Contracts, Quotations, and others — but never wired to the AI-capture confidence path above | `supabase/migrations/00000000000000_initial_schema.sql` |
| Generic router UI | **Retired.** `CaptureForm.tsx` (a single "capture anything, let AI figure it out" screen) was deliberately removed in Sprint 48 in favour of per-domain screens. | Sprint 48 Outcomes, Phase 4 Checklist Master |
| External channels | **None, of either kind.** No inbound WhatsApp, no inbound email, no webhook receiver, and no "share/forward into AiFA" surface either (no registered OS share-target, no in-app paste/forward screen). The only WhatsApp code is outbound (`build_whatsapp_quotation_link` — a click-to-chat link the owner still sends themselves). | Exhaustive repo grep, confirmed live this sprint |
| Purchase Order as a document | **Does not exist.** "Purchase" today is a single transaction record classified like a receipt — not a multi-line document with its own lifecycle (approve → stock → payment). | No `purchase_order` table, repository, or UI anywhere in the schema |

**Read plainly:** the hard part — a real AI call, confidence-gated auto-posting, and a working generic approval-task engine — is already built and proven on one channel. The missing part is channel breadth and cross-document chaining, not the core intelligence.

**CORRECTION (5 September 2026, Sprint 53 pre-implementation finding):** the row above
is true as a description of `capturePipeline.ts` in isolation, but reads misleadingly
as if that pipeline is what the live Phase 4 app runs on. It is not. `capturePipeline.ts`
writes only to the local, end-to-end-encrypted `business_events`/`business_data`/
`ledger_entries` tables (Vol 13_1 §8 "Path A"). There is no `public.business_events` or
`public.business_data` table in Supabase at all — only `public.ledger_entries`, which
Path A's local ledger never writes to. Every Phase 4 page an owner actually looks at
(Ledger, Cash Book/P&L, Full Reports, Business Overview's Snapshot) reads exclusively
from a second, separate, plaintext data plane ("Path B") written by direct Supabase RPC
transports (`paymentVouchersReportsTransport.ts`, `attendanceLeaveCommissionTransport.ts`,
`quotationInvoiceTransport.ts`, etc.) — the architecture every Phase 4 sprint (37-49)
actually shipped on. The two planes do not interoperate: a capture posted through Path A
is real, encrypted, and durable, but invisible to every Phase 4 report. Sprint 53 was
retargeted before implementation to route into Path B directly rather than reviving a
Path A-only front door — see that sprint's own correction note for the consequences
(no photo capture, no one-shot sale/purchase capture, this sprint). Path A remains a
real, working, tested engine — it is simply not the one the live shell reports from,
and a future decision (bridge the two, or formally sunset Path A once Path B covers the
same ground) is now owed rather than left implicit.


## 4. Target Architecture — The Router

```text
        WhatsApp msg    Email           In-App           In-App           (future: voice
        shared/         forwarded/      typed text        photo            note, forwarded
        forwarded BY    pasted BY       (owner's own      (owner's own     from within the
        the logged-in   the logged-in   session)          session)         app, same model)
        owner           owner
           |               |                |                |                     |
           v               v                v                v                     v
     +-----------------------------------------------------------------------------------+
     |                    CHANNEL ADAPTERS (Section 5)                                    |
     |   each adapter's only job: confirm the authenticated session, normalise to         |
     |   Channel Intake -- no adapter here ever listens on a public WhatsApp number       |
     |   or public mailbox; every intake was chosen and sent by the logged-in owner       |
     +-----------------------------------------------------------------------------------+
                                        |
                                        v
                         Channel Intake (Section 6) -- one shape,
                         regardless of which adapter produced it
                                        |
                                        v
                         Domain Classifier (existing `classifyAndRoute`
                         core, extended per Section 7 -- expense / sale /
                         purchase / leave / purchase_order / unclassified)
                                        |
                                        v
                         Confidence + Approval Routing (Section 8) --
                         channel AND domain jointly decide auto-record /
                         draft-confirm / must-approve / clarify
                                        |
                                        v
                         Business Event + Business Data (Vol 4_0) --
                         the same canonical record every existing
                         domain already writes to
                                        | (on approval, Section 9)
                                        v
                         may enqueue a NEW Channel Intake of a
                         different domain -- chaining without a
                         bespoke orchestrator per document type
```

This is a horizontal extension of Vol 5_0 §4's Platform Flow, not a replacement — "Task or Business Event" at the top of that diagram is exactly what Channel Intake produces here.

## 5. Channel Adapters

**Owner decision:** every channel below is reached from inside the owner's own authenticated AiFA session. AiFA never operates a public WhatsApp Business number or a public inbound mailbox that a stranger could message. The owner receives something on WhatsApp or email exactly as they do today, decides it is business-relevant, and forwards or shares it into AiFA themselves — the forwarding action IS the approval to even look at it. This is a materially smaller and safer system than a true inbound listener, and it is the one built first.

An adapter converts one medium into the common Channel Intake shape (Section 6). It performs exactly two jobs and nothing else: confirm the content arrived through an authenticated session, and normalise it. It never classifies domain and never decides confidence — that discipline is what keeps N channels from becoming N pipelines.

| Channel | How content reaches AiFA | Normalisation | Build cost |
|---|---|---|---|
| In-app typed / photo (existing) | Owner types or photographs directly inside the app | Already done by `capturePipeline.ts` | Built |
| WhatsApp, forwarded by owner | **Mobile:** owner taps Share on a WhatsApp message/image and picks AiFA from the OS share sheet (Android `Intent.ACTION_SEND` / iOS Share Extension — AiFA registers itself as a share target). **Web:** owner pastes the forwarded text, or drags in a saved screenshot/image, on a "Forward to AiFA" screen. | Shared text → text intake; shared image → photo intake — same intake shape as native in-app capture | Low-medium — no external account, no Meta review, no template approval; the work is a share-target registration (mobile) plus one paste/drop screen (web), not a messaging integration |
| Email, forwarded by owner | Owner uses their own mail app's native "Forward" or "Share" to hand the message (and any attachment) to AiFA, same mechanism as WhatsApp above; or pastes the forwarded text into the same "Forward to AiFA" screen on web | Attachment → image/PDF intake; body text → text intake | Low-medium — identical mechanism to WhatsApp above; no inbound mailbox or webhook needed at all under this model |
| Voice note (any of the above) | Owner shares/forwards a voice note the same way | Transcribe, then treat as text intake | Smallest incremental add once the share-target/paste surface exists, since it only adds a transcription step before the existing text path |

**Trust boundary, restated under this model:** because every intake above only ever enters through the owner's own authenticated session, the external-sender-verification problem the first draft of this volume raised (matching a phone number or email address on file, rejecting unrecognised senders before any AI call) **does not apply** — there is no unauthenticated surface for a stranger to reach at all. What replaces it is a narrower, honest assumption worth stating plainly: AiFA trusts that content the owner chose to forward is what it claims to be. It does not re-verify that a forwarded WhatsApp message actually came from who it says it did, or that a forwarded email wasn't itself spoofed before it ever reached the owner's inbox — that verification, to the extent it happens, is upstream of AiFA, in WhatsApp's and the mail provider's own systems. This is a materially smaller trust surface than a true inbound listener would carry, and is the right first step; Section 11 notes true unattended inbound (no owner forwarding step) as a distinct, deferred, and harder future upgrade, not something this design silently rules out forever.

## 6. Channel Intake — The One Shape Every Adapter Produces

```text
ChannelIntake {
  channel: "in_app_text" | "in_app_photo" | "shared_whatsapp" | "shared_email" | ...
  businessMembershipId: <the forwarding owner's own session, per Section 5 -- always
                          the authenticated caller, never inferred from message content>
  rawText: string | null
  rawMedia: { mimeType, bytes }[] | null
  receivedAt: timestamp
  channelMetadata: { ...whatever only that channel needs, e.g. the original app the share came from }
}
```

This is deliberately smaller than a Business Event (Vol 4_0 §2) — Channel Intake is pre-classification, a Business Event is post-classification. The Domain Classifier (Section 7) is what turns one into the other, exactly as `classifyAndRoute` already turns a photo or typed string into a Business Event today.

## 7. Domain Classification Must Expand

`BusinessDomain` (`packages/core/src/ai/types.ts`) is `"expense" | "sale" | "purchase"` today. Two additions matter for the workflows this volume was written to address, and both close the exact gaps found in this session's audit of the codebase:

- **`leave_application`** — a domain the approval engine already fully supports (`create_leave_application` → `create_approval_task`) once a Channel Intake exists to trigger it. No new approval machinery needed — only wiring a classifier for it and giving it a real inbound channel.
- **`purchase_order`** — genuinely new. Today's `purchase` domain is one transaction, classified once and posted. A PO needs to become a first-class multi-line document with its own status lifecycle (drafted → approved → [stock received] → [paid] → closed) — this is a Vol 6_2 (Purchase Operations) extension in its own right, not something this volume's router alone can retrofit. Section 9 defines the chaining mechanism it would use once that entity exists; this volume does not design the entity itself.
- **`unclassified`** — mandatory, and does not exist today. Anything the classifier cannot confidently place into a known domain must land in a human triage queue, never silently dropped and never guessed into the wrong domain. This is the router's own safety valve, distinct from any one domain's `clarify` outcome.

## 8. Confidence + Approval Routing Becomes Two-Dimensional

Today, confidence routing (`auto_record` / `draft_confirm` / `clarify`) is domain-scoped only — every expense above `auto_record_min` posts immediately, regardless of how it arrived, because the only source today is a mature, purpose-built vision extraction. That assumption does not automatically transfer to a forwarded WhatsApp message or email: the sender is equally trustworthy (Section 5), but the AI's ability to correctly parse unstructured forwarded prose has no track record yet.

The routing decision must become a function of **channel × domain**, not domain alone — but under the owner-forwarded model (Section 5), the reason is subtler than "an external channel is less trustworthy." The owner forwarding a WhatsApp message IS an authenticated, deliberate act, exactly as trustworthy as typing the same information into a form. What is genuinely weaker is the *extraction*, not the *sender*: a forwarded WhatsApp message or email is unstructured prose an AI must parse, where a photo capture already benefits from Sprint 5's purpose-built vision extraction and a growing per-vendor trust history (`businessKnowledgeRepository.ts`). A brand-new extraction path should earn the same auto-record trust a mature one has, not inherit it on day one.

| | High confidence | Low confidence |
|---|---|---|
| In-app photo (existing, mature extraction) | auto-record (unchanged) | draft-confirm / clarify (unchanged) |
| Forwarded WhatsApp / email, financial domain (expense, purchase) | draft-confirm at first — a new extraction path earns auto-record over time via Vol 5_4's feedback loop, the same way vendor-category trust already is, rather than being granted it by fiat on day one | clarify, or unclassified triage |
| Forwarded WhatsApp / email, leave/approval-style domain | routes straight into the existing `create_approval_task` engine — a human decision was always going to happen regardless of channel |

This table is a starting position for the first implementation, not a final policy — it should be owner-configurable per Vol 5_4 (AI Learning & Feedback Architecture)'s existing feedback loop, the same way vendor-category trust is already learned per business (`businessKnowledgeRepository.ts`'s `TRUSTED_CONFIRMATION_THRESHOLD`).

## 9. Post-Approval Chaining, Without a Bespoke Orchestrator

The third workflow in the original ask — an approved PO automatically carrying through to stock and payment — does not need a new "orchestration engine." It needs one rule: **an approved Business Event may itself construct a new Channel Intake**, re-entering the exact same router at Section 4's second stage, tagged with the domain the next step belongs to (e.g., an approved PO line becomes a `stock_receipt_pending` intake; a received-and-matched delivery becomes a `payment_due` intake). Each step still goes through its own confidence/approval routing per Section 8 — chaining does not mean skipping review, it means the human never has to re-type data the system already has.

This keeps ADR-001 intact (Vol 4_0 §7): every step in the chain is still its own canonical, immutable Business Event, linked to its predecessor, never a silent mutation of the PO record itself.

## 10. Rollout Sequencing

The owner-forwarded model in Section 5 changes this sequencing substantially from the first draft of this volume: because neither WhatsApp nor email needs an external account, Meta review, or an inbound mailbox under this design, they are no longer the slow, externally-gated tier — they are close to the same build cost as the in-app router UI itself, since all three ultimately feed the identical intake path.

1. **Re-generalise the in-app router UI** — bring back a `CaptureForm`-equivalent screen spanning the expanded domain list (Section 7), including `leave_application`. Near-zero new infrastructure: 100% existing pipeline, one more screen. Do this first regardless, since every other channel below still lands here.
2. **Web "Forward to AiFA" paste/drop screen** — the fastest way to prove the owner-forwarded model end-to-end: one screen accepting pasted text or a dropped image, reusing the existing text/photo intake untouched. No mobile OS integration needed yet.
3. **Mobile share-target registration** (Android `Intent.ACTION_SEND` receiver, iOS Share Extension) — the natural, low-friction version of step 2: the owner shares straight out of WhatsApp or their mail app instead of switching apps to paste. This is what makes the workflow actually feel like "one input" day to day, and it is genuinely mobile-platform work, not a messaging integration — no Meta review, no WhatsApp Business Platform account, no per-message cost.
4. **Purchase Order as a real multi-stage entity** (Vol 6_2 extension) and voice-note transcription are follow-on work once the share/forward surface exists to prove the router pattern end-to-end.
5. **A true inbound listener** (a public WhatsApp Business number or receiving mailbox, per the original Section 5 design this revision replaced) remains available as a later, separate upgrade if a future need for unattended intake (no owner forwarding step at all) ever justifies its much larger trust and compliance surface — not part of this rollout.

## 11. What This Volume Does Not Solve

- The concrete PO entity, its schema, and its stock/payment linkage — that is Vol 6_2's job; this volume only defines how an approved step re-enters the router (Section 9).
- **Unattended inbound intake** — a public WhatsApp Business number or receiving mailbox that accepts content with no owner forwarding step at all. The owner-forwarded model in Section 5 was a deliberate choice to avoid this surface for now (no external account, no Meta review, no unauthenticated sender to defend against); a genuine future need for it — e.g. a supplier emailing invoices directly rather than via the owner's own inbox — would require revisiting Section 5's trust boundary from first principles, including the external-sender-verification and abuse/spam handling this revision was able to set aside.
- Whether a forwarded message actually came from who it claims to (WhatsApp's/the mail provider's own authenticity guarantees, not AiFA's) — out of scope by design, per Section 5's restated trust boundary.

## 12. Relationships to Other Volumes

- Vol 10_5 §2 states the principle this volume exists to make concrete.
- Vol 4_0 §2-3 already scoped voice/message/import as valid Business Event Layer inputs — this volume is that scope's implementation plan.
- Vol 5_0 §4 (Platform Flow), Vol 5_2 §4.1 (single pipeline, not per-channel agents) — this volume's router sits upstream of both, unchanged.
- Vol 5_4 (AI Learning & Feedback) — the channel × domain routing table in Section 8 should be learned/adjusted per business over time, the same mechanism already used for vendor-category trust.
- Vol 6_0 §4 (shared engine, domain-scoped rules) — the precedent this volume's Section 2 generalises one layer up.
- Vol 6_2 (Purchase Operations) — owns the PO entity itself; this volume only defines how it would chain.
- Vol 8_1 (Identity & Access Management) — the session authentication every channel in Section 5 relies on; no separate per-channel identity check is needed under the owner-forwarded model.
- Vol 8_2 (Security & Data Protection) — would govern the external-sender trust boundary if a future unattended inbound listener (Section 11) is ever built; not load-bearing for the owner-forwarded model this revision adopts.
- Vol 8_3 (Integration & API Architecture) — covers external *data* integrations (bank feeds, POS); this volume covers external *communication* channels a human sends input through. Both meet at the same principle (Vol 8_3 §3): every boundary produces or consumes a Business Event, never a parallel data model.

---

*End of Volume 5_5.*
