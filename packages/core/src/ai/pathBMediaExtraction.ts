/**
 * Path B Media & Voice Extraction — Sprint 55 (Phase 5, Universal Media &
 * Voice Intake Foundation).
 *
 * Turns the "deferred" gaps Sprint 53 (photo capture dropped) and Sprint 54
 * (image/PDF drop zone disabled) both disclosed into one real, shared
 * capability every current and future channel can use. This is
 * DELIBERATELY NOT a rewrite of the existing vision call — it reuses
 * `AiProvider.extractExpenseFromImage()` (the same real, tested call
 * Sprint 5/6 proved) and `AiProvider.transcribeAudio()` (new this sprint)
 * verbatim. What's new here is that extraction output feeds the SAME
 * Path B confirm-before-post form (`CaptureResolveForm`/
 * `useCaptureRouterCore.ts`) every text capture already uses, instead of
 * Path A's local `business_events`/`ledger_entries` tables. Nothing here
 * ever posts a ledger entry directly — it only pre-fills the same form a
 * human still confirms, exactly like text detection already does.
 *
 * Per Vol_5_5 §8's own reasoning (a brand-new extraction path should earn
 * auto-record trust, not inherit it): this always requires confirmation,
 * same as every other Sprint 53/54 capture. There is no auto-record branch
 * here at all.
 */
import type { AiProvider, VisionExtractedFields } from "./types";

export type MediaExtractionStatus = "complete" | "partial" | "failed";

export interface MediaExtractionOutcome {
  status: MediaExtractionStatus;
  fields: VisionExtractedFields | null;
}

/**
 * Runs image/PDF extraction through whatever vision capability the given
 * provider offers (Gateway-first on web, direct-key on mobile — see
 * `compositeProvider.ts`'s Sprint 55 update) and returns fields to
 * pre-fill the expense confirm form. Never throws for an honest "the
 * provider has no vision capability configured" case — that maps to
 * `status: "failed"`, `fields: null`, the same shape a genuinely unreadable
 * image already produces (Vol 7_1 §5.1), so the UI shows one consistent
 * "couldn't read this — fill it in yourself" message rather than two.
 * A real network/config error (e.g. the Gateway's /ai-vision route not
 * existing yet) also degrades to this same honest shape rather than
 * throwing all the way up to the UI as an unhandled exception — the owner
 * still sees a clear "couldn't read this" outcome instead of a crash.
 */
export async function extractMediaViaPathB(
  provider: AiProvider,
  media: { base64Data: string; mimeType: string; kind: "image" | "pdf" },
): Promise<MediaExtractionOutcome> {
  if (!provider.extractExpenseFromImage) {
    return { status: "failed", fields: null };
  }
  try {
    const { result } = await provider.extractExpenseFromImage({
      base64Image: media.base64Data,
      mimeType: media.mimeType,
      kind: media.kind,
    });
    return { status: result.extractionStatus, fields: result.extractedFields };
  } catch {
    // See this function's own doc comment — a thrown error (no
    // capability, network failure, Gateway route missing) is treated the
    // same as a genuinely unreadable document, not surfaced as a crash.
    return { status: "failed", fields: null };
  }
}

export type VoiceTranscriptionOutcome =
  | { status: "transcribed"; transcript: string }
  | { status: "not_configured" }
  | { status: "failed" };

/**
 * Transcribes a voice note, then hands the transcript back as PLAIN TEXT —
 * the caller feeds it straight into the existing
 * `classifyChannelIntakeDomain` text path (`inputRouter.ts`). No new
 * classification logic exists for voice: once transcribed, a voice note IS
 * a text capture. `not_configured` is a distinct, honestly-labelled
 * outcome from `failed` — see `AiProvider.transcribeAudio`'s own doc
 * comment in types.ts for why neither shipped provider implements this
 * yet (a real speech-to-text vendor decision, not a missing route).
 */
export async function transcribeVoiceForPathB(
  provider: AiProvider,
  media: { base64Data: string; mimeType: string },
): Promise<VoiceTranscriptionOutcome> {
  if (!provider.transcribeAudio) {
    return { status: "not_configured" };
  }
  try {
    const { result } = await provider.transcribeAudio({
      base64Audio: media.base64Data,
      mimeType: media.mimeType,
    });
    if (result.status === "complete" && result.transcript) {
      return { status: "transcribed", transcript: result.transcript };
    }
    return { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}
