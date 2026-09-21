# Sprint 54 — Web "Forward to AiFA" Channel

**Duration:** Weeks 3-4 (of Phase 5)
**Architecture references:** Vol_5_5 §5 (owner-forwarded channel model), §6 (Channel Intake shape)

**CORRECTION (6 September 2026, made before any Sprint 54 code was written):** This
doc (and Vol_5_5 §4/§6/§7 themselves) were written before Sprint 53's Path A→B
retarget and still describe Channel Intake feeding `classifyAndRoute`/
`capturePipeline.ts` (Path A) and a dropped image/PDF going through "the existing
vision pipeline." Sprint 53 actually shipped on Path B (a local heuristic,
`inputRouter.ts`, dispatching straight to `createPaymentVoucher`/
`createLeaveApplication`/`capture_triage`) and explicitly dropped photo/vision
capture from scope, because Path B has no image-extraction RPC. Building Sprint 54's
image/PDF drop zone against Path A now would reintroduce the exact "captured but
invisible to every report" bug Sprint 53 fixed, for this one path.

**Retargeted scope, decided with the owner before implementation (same discipline as
Sprint 53's own correction):** this sprint ships **text-only** forwarding. Pasting
forwarded WhatsApp/email text flows through the real Path B core (now shared via
`web/src/shell/captureRouter/useCaptureRouterCore.ts`, extracted from Sprint 53's
`CaptureRouterPage.tsx` as a behaviour-preserving refactor). The drop zone for a
forwarded image/PDF is shown on the new screen but disabled, honestly labelled as
deferred to a future sprint once a Path B-compatible vision-extraction transport
exists — not silently omitted, not wired to the wrong path.

---

## Theme

The first genuinely new channel, and the first time the Channel Intake abstraction (Vol_5_5 §6) is actually implemented rather than only designed. Deliberately the cheapest possible real channel — no OS integration, no external account — to prove the router pattern end-to-end before Sprint 55's mobile work.

## Objectives

An owner, at their computer, can paste text forwarded from WhatsApp or email, or drop a saved screenshot/image/PDF, onto one "Forward to AiFA" screen inside the web app, and have it flow through the exact same classification and confidence routing Sprint 53's in-app capture uses — with no separate code path.

## Task Breakdown

### Channel Intake abstraction
- Implement `ChannelIntake` (Vol_5_5 §6) as a real type/module for the first time: `{ channel, businessMembershipId, rawText, rawMedia, receivedAt, channelMetadata }` — `packages/core/src/ai/channelIntake.ts`. `rawMedia` is present in the shape per Vol_5_5 §6 but unused this sprint (see the correction above)
- Extract Sprint 53's router entry points (`handleDetect`/`handleSubmit`/`handleResolveTriage`) into a shared `useCaptureRouterCore.ts` hook so both the in-app text screen and the new Forward-to-AiFA screen call the SAME functions against a `ChannelIntake` — a refactor of the entry point, not a rewrite of the Path B dispatch logic itself

### Web adapter
- New "Forward to AiFA" page (`ForwardToAifaPage.tsx`): a text paste area, a source picker (WhatsApp / Email / Other — `channelMetadata.source`), and a drag-and-drop image/PDF zone shown but disabled with an honest "not available yet" label (see the correction above)
- Pasted text → `ChannelIntake` with `channel: "shared_whatsapp" | "shared_email" | "forwarded_web"` per the source picker

### Trust boundary (restated, not re-litigated)
- No sender/content verification beyond the existing authenticated session (Vol_5_5 §5) — this sprint does not add identity checks, because none are architecturally required under the owner-forwarded model

## Definition of Done

- [x] Pasting forwarded WhatsApp-style text on the new screen produces a classified record through the identical Path B core (`useCaptureRouterCore`'s `handleDetect`/`handleSubmit`) Sprint 53's in-app screen uses — verified by tracing the same function call (both pages import and call the same hook), not merely the same visible outcome. `tsc`/`eslint` clean; **live smoke test pending**
- [x] Image/PDF forwarding explicitly deferred (see correction above) rather than silently dropped or wired to the wrong path — the drop zone is visible and honestly labelled
- [x] `ChannelIntake` is a real, shared type consumed by at least two adapters (in-app via `CaptureRouterPage.tsx`, forwarded via `ForwardToAifaPage.tsx`) — not two independent almost-identical structs; both call `createTextChannelIntake` and pass the result into the identical shared hook
- [x] `npm run typecheck` and `npm run lint` pass clean in `web/`

## Dependencies

Sprint 53 (router UI and expanded domain list must exist for this new channel to feed into).

## Risks

| Risk | Mitigation |
|---|---|
| Refactoring existing entry points to consume `ChannelIntake` could regress the two channels already working (in-app text/photo) | Treat this as a behaviour-preserving refactor first (existing channels produce identical `ChannelIntake` values to what they already pass today), verified before adding the new adapter |
| Users may paste content that isn't obviously text or image (e.g. a forwarded contact card, a location pin) | Anything that doesn't cleanly map to text or media falls to `unclassified` (Sprint 53's triage queue), not a crash or a silent no-op |

## Safe to Carry Over

Auto-detecting whether pasted text looks like it came from WhatsApp vs. email (for `channelMetadata` provenance) — cosmetic, does not block Sprint 55.

---

*End of Sprint 54 (retargeted to Path B / text-only, 6 September 2026).*
