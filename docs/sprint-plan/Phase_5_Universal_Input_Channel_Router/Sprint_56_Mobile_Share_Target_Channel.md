# Sprint 56 — Mobile Share-Target Channel

**Duration:** Weeks 7-8 (of Phase 5)
**Architecture references:** Vol_5_5 §5 (mobile share-target row), §10 step 3

---

## Theme

Makes the owner-forwarded model actually feel like "one input" day to day: sharing straight out of WhatsApp or a mail app, instead of switching to AiFA to paste. Platform (Android/iOS) integration work, not a messaging-service integration — no external account, no review process.

## Objectives

On both Android and iOS, AiFA appears as a share target when the owner taps Share on a WhatsApp message, image, or email. Sharing text or an image into AiFA produces the same `ChannelIntake` Sprint 54's paste/drop screen produces, reaching the identical classification core, and shared images route through Sprint 55's real Path B media-extraction pipeline (not a stub) exactly as the web "Forward to AiFA" screen's now-enabled drop zone does.

## Task Breakdown

### Android
- Register an `Intent.ACTION_SEND` (and `ACTION_SEND_MULTIPLE` for multiple images) receiver in the Expo/React Native app config, surfacing AiFA in the OS share sheet for `text/plain` and `image/*` mime types
- Handle the received intent, constructing a `ChannelIntake` identical in shape to Sprint 54's web adapter output — a shared image goes through Sprint 55's `extractMediaViaPathB`, not a new extraction path

### iOS
- Add a Share Extension target (or the Expo-managed equivalent, if the current Expo SDK version supports it without ejecting — confirm this first, since it materially changes build cost) accepting text and images
- Same `ChannelIntake` construction as Android

### Shared
- A lightweight in-app confirmation screen after a share completes ("Got it — reviewing your leave request…" or similar), so the owner has feedback that the share actually reached AiFA and isn't just silently gone

## Definition of Done

- [ ] Sharing a WhatsApp text message to AiFA on a real Android device produces a classified record through the same Path B core as Sprints 53-54
- [ ] Sharing a WhatsApp/email image to AiFA on a real Android device is extracted via Sprint 55's Path B media-extraction pipeline (the same one the web adapter uses), landing in the confirm-before-post form exactly like a typed capture
- [ ] iOS share-target behaviour verified on a real device or (if genuinely unavailable this sprint) explicitly disclosed as unverified, per this phase's own DoD rule 4 — not silently assumed to mirror Android
- [ ] `npm run typecheck` and `npm run lint` pass clean in `app/`

## Dependencies

Sprint 53 (router/domains), Sprint 54 (`ChannelIntake` abstraction this sprint's adapters must produce, not reinvent), Sprint 55 (Path B media/voice extraction this sprint's image/voice shares must reuse, not reinvent).

## Risks

| Risk | Mitigation |
|---|---|
| This session's Linux device-bridge shell cannot build or run a live Expo/React Native session with native share-target code (the same class of gap Sprint 37/40/49 disclosed for Vite/Rollup) — native share-intent behaviour genuinely cannot be verified from this environment | State this plainly rather than claiming static-code-trace confidence is equivalent to a live device test; a real device test by the owner (or whoever runs the mobile build) is this sprint's actual verification step, matching Sprint 49's own precedent for environment-constrained sprints |
| iOS Share Extension may require ejecting from the managed Expo workflow, which is a materially larger change than Android's manifest-level intent filter | Confirm Expo SDK support before committing to a timeline; if ejection is required, treat iOS as a separately-scoped follow-up rather than blocking Android from shipping |

## Safe to Carry Over

Handling a shared voice note specifically (vs. generic audio/*) — Vol_5_5 §5 already scopes voice transcription as a distinct, not-yet-committed capability (see Phase 5 Overview's "Explicitly out of scope").

---

*End of Sprint 56.*
