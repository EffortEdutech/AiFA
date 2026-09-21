# Sprint 55 — Universal Media & Voice Intake Foundation

**Duration:** Weeks 5-6 (of Phase 5)
**Architecture references:** Vol_5_5 §5 (voice-note row), §6 (`rawMedia`), §8 (a brand-new extraction path earns trust, it isn't granted it)

**WHY THIS SPRINT EXISTS (inserted 6 September 2026, owner request):** while
testing Sprint 54, the owner stated plainly that AiFA's real business
process "mostly involve[s] pdf files, images, text, voices no matter it
comes from email or whatsapp or other sources." Sprints 53-54 both
deliberately deferred non-text media (Sprint 53 dropped photo capture from
its Path B retarget; Sprint 54 shipped its "Forward to AiFA" drop zone
honestly disabled). Rather than let Sprint 56 (mobile share-target) ship
text-only against the same gap a third time, this sprint is inserted before
it to build ONE real, shared media/voice extraction foundation every
current and future channel can use — consistent with Vol_5_5 §2's own rule
that a channel's job is only to normalise input, never to reimplement
extraction per channel. **Sprints 55-59 below are renumbered from the
original 55-58 plan to make room for this insertion** — see each
renumbered sprint's own file for its updated cross-references.

---

## Theme

Turn two disclosed gaps (Sprint 53's dropped photo capture, Sprint 54's
disabled drop zone) into one real capability: image/PDF extraction that
actually posts through Path B, plus a new, honestly-gated voice
transcription path. Both media types funnel into the SAME confirm-before-
post core (`useCaptureRouterCore.ts`) text capture already uses — no new
dispatch logic, only new ways to arrive at the same form.

## Objectives

An owner can drop a forwarded receipt/invoice image or PDF on "Forward to
AiFA" and have the real AI vision extraction (proven since Sprint 5/6)
pre-fill the same expense confirm form Quick Capture already uses, posting
through the identical `createPaymentVoucher` call once confirmed — never a
second, Path-A-shaped copy. A forwarded voice note, once transcribed,
becomes a normal text capture and rides the exact same classification path
everything else already uses. Where a capability genuinely isn't configured
yet (voice transcription; the Gateway's image route), the owner sees an
honest status, never a silent failure or a fabricated result.

## A hard constraint found mid-sprint, disclosed rather than worked around

The AI Gateway (`ai-gateway-service`) — the safe, server-side proxy that
lets **web** call a vision model without shipping an API key in the public
bundle — lives in a **separate repository** this session cannot reach.
Owner decision: build the AiFA-side contract now (client code, fully typed,
ready to call) and document the exact Gateway route it needs
(`POST {gatewayUrl}/ai-vision` — full request/response shape in
`gatewayProvider.ts`'s own header comment), rather than inventing a fake
working feature or blocking this sprint entirely. **That Gateway route does
not exist yet.** Every web image/PDF attempt will fail honestly (shown as
"couldn't read this — a vision-capable connection isn't available yet on
web") until someone with access to `ai-gateway-service` builds the matching
route. Mobile is unaffected — it already has a working direct-key vision
path (Sprint 5/6) that this sprint extends with PDF support directly.

## Task Breakdown

### Provider contract extensions (`packages/core`)
- `VisionExtractionInput` gains `kind?: "image" | "pdf"` (default `"image"`,
  zero impact on every existing call site)
- New `AudioTranscriptionInput`/`AudioTranscriptionResult` types; new
  optional `AiProvider.transcribeAudio()` method
- `anthropicProvider.ts`: `extractExpenseFromImage` branches to Anthropic's
  real `"document"` content-block type when `kind === "pdf"` (a real,
  addable capability — same "not exercised by the test suite, needs a real
  key and network" caveat this file already discloses for every other
  call). Does NOT implement `transcribeAudio` — no raw-audio capability in
  this provider's model
- `gatewayProvider.ts`: implements `extractExpenseFromImage` against the
  new, documented, **not-yet-built** `/ai-vision` Gateway route (see the
  constraint above). Does NOT implement `transcribeAudio` either — a real
  speech-to-text vendor decision belongs to the owner, same class of
  decision as Phase 3's e-Invoice/WhatsApp external-account dependencies,
  not something to silently pick
- `compositeProvider.ts`: `GatewayOrLocalExpenseProvider.extractExpenseFromImage`
  now tries the Gateway first (if signed in), falls back to an injected
  direct-vision provider (mobile's existing path) if the Gateway attempt
  fails, and throws an honest error only if neither is available — no
  silent no-op

### Path B media/voice extraction core (NEW: `packages/core/src/ai/pathBMediaExtraction.ts`)
- `extractMediaViaPathB(provider, media)` — calls the SAME vision method
  above, returns extracted fields for the UI to pre-fill, never writes
  anything itself (Path B posting still only happens on owner confirm,
  exactly like text)
- `transcribeVoiceForPathB(provider, media)` — three honest outcomes:
  `transcribed` (hands a transcript back as plain text), `not_configured`
  (no provider implements it — see above), `failed` (a real attempt that
  didn't produce usable text)

### Web UI (`ForwardToAifaPage.tsx`, `useCaptureRouterCore.ts`)
- `useCaptureRouterCore` gains `handleDetectMedia`/`handleDetectVoice`,
  both populating the SAME `detectedDomain`/resolved-fields state text
  detection already uses — `CaptureResolveForm` needed zero changes
- The previously-disabled drop zone now accepts a real image/PDF drop or
  browse, showing extraction status live (`extracting` / `failed` with the
  Gateway-route caveat spelled out)
- A new "Upload voice note" control, honestly showing `transcribing` /
  `not_configured` / `failed`
- A dropped file that isn't an image/PDF (Sprint 54's own disclosed risk —
  a forwarded contact card, a location pin) falls to the unclassified
  triage path, never a crash or silent no-op

### Deliberately NOT done this sprint (disclosed, not silently dropped)
- Fuzzy-matching the AI's read counterparty name to an existing `Party` —
  the extracted name is shown as a hint only; the owner still picks the
  payee from the dropdown, same as every other Sprint 53/54 capture
- Wiring media through the full `ChannelIntake.rawMedia` field end-to-end
  — this sprint's web adapter calls the extraction functions directly with
  `{base64Data, mimeType, kind}` rather than routing through a constructed
  `ChannelIntake` for media specifically (text intake still uses the real
  `ChannelIntake` type). `rawMedia` stays in the type for Sprint 56 (mobile
  share-target) to wire fully once a share intent's image needs to cross
  that boundary — revisit then rather than over-build a path with no
  second consumer yet
- Building the actual Gateway `/ai-vision` route or choosing a
  speech-to-text vendor — both require access/decisions outside this
  session (see the constraint above)
- Any mobile UI change — Sprint 55 only extends the shared provider
  contract; Sprint 56 (mobile share-target) is where mobile SHARING
  consumes it. Mobile's existing in-app photo capture screen already calls
  `extractExpenseFromImage` and is untouched by this sprint

## Definition of Done

- [x] `VisionExtractionInput.kind` added, additive, zero regression to
      existing photo-capture call sites — `tsc` clean in `web/` and `app/`
- [x] `anthropicProvider.ts` branches to a `"document"` content block for
      `kind: "pdf"` — real code, **live-unverified** (needs a real network
      call + key, same caveat this file already carries for every call)
- [x] `gatewayProvider.ts` implements `extractExpenseFromImage` against a
      fully documented `/ai-vision` contract — **cannot succeed yet**, the
      matching Gateway route doesn't exist in the separate
      `ai-gateway-service` repo this session can't reach; this is expected,
      not a bug
- [x] `compositeProvider.ts` routes vision Gateway-first-then-direct with
      an honest thrown error only when neither path exists
- [x] `pathBMediaExtraction.ts` never writes to Path A or Path B directly —
      verified by reading the file: it only returns data for the UI to
      show/pre-fill
- [x] Web "Forward to AiFA" drop zone accepts a real image/PDF drop and
      shows live status (not a static disabled label anymore)
- [x] Voice upload control shows an honest `not_configured` state, not a
      fake transcription
- [x] `npm run typecheck` and `npm run lint` pass clean in `web/` and
      `app/`; `app/`'s existing `capturePipeline`/`documentsAndPhotoCapture`
      test suites re-run and still pass (20/20) — confirms this sprint's
      provider-contract changes didn't regress Sprint 5/6's existing photo
      capture
- [ ] **Live smoke test pending** (owner): confirm a real forwarded receipt
      photo/PDF shows the honest failure message on web (expected, until
      the Gateway route ships) and that mobile's existing photo capture is
      genuinely unaffected

## Dependencies

Sprint 53 (Path B core), Sprint 54 (`ChannelIntake`, `useCaptureRouterCore`,
`ForwardToAifaPage`) — this sprint extends both rather than replacing them.

## Risks

| Risk | Mitigation |
|---|---|
| The Gateway contract was designed without access to the Gateway's own codebase — a real integration attempt could reveal the documented shape doesn't match what's easiest to build there | Documented as a proposal for whoever builds the matching route to review and adjust, not a demand; `gatewayProvider.ts`'s header states this plainly |
| A future contributor could see `transcribeAudio` on `AiProvider` and assume voice already works | Every honest-not-configured surface (UI text, code comments, this doc) states plainly that no provider implements it yet and names why |
| Extending `extractExpenseFromImage` to accept PDFs is unverified against the real Anthropic API from this sandbox | Same disclosed limitation this file already carries for every other live call — owner verification with a real key is the actual verification step, not assumed passing from a clean `tsc` |

## Safe to Carry Over

Full `ChannelIntake.rawMedia` wiring (deferred to Sprint 56, which has a
second real consumer for it); fuzzy party-matching from AI-read
counterparty names; choosing and wiring a real speech-to-text vendor once
the owner decides on one.

---

*End of Sprint 55 (inserted 6 September 2026).*
