/**
 * Channel Intake — Sprint 54 (Phase 5, Vol_5_5 §6).
 *
 * The one shape every capture "channel adapter" produces, regardless
 * of how the content physically arrived. Per Vol_5_5 §2's governing
 * separation: a CHANNEL's only job is to confirm the input arrived
 * inside an authenticated session and normalise it into this shape —
 * it never classifies domain and never decides confidence. That is
 * the Domain Classifier's job (Sprint 53's `classifyChannelIntakeDomain`,
 * `./inputRouter.ts`), which stays completely unaware of which channel
 * produced the intake it's looking at.
 *
 * PATH B, NOT PATH A — same correction as Sprint 53 (see
 * `capturePipeline.ts`'s header and Vol_5_5 §3's correction note).
 * Vol_5_5 §6 originally described Channel Intake feeding
 * `classifyAndRoute`/Business Event (Path A). Sprint 53 retargeted the
 * router to Path B transports before any Channel Intake existed, so
 * this type is written directly against that reality: `rawText` is
 * what Sprint 53's router core (now shared via
 * `web/src/shell/captureRouter/useCaptureRouterCore.ts`) actually
 * consumes. `rawMedia` is included for shape-completeness per Vol_5_5
 * §6 but is UNUSED this sprint — Sprint 54 deliberately ships
 * text-only channels (see Sprint_54's own scope correction); a future
 * sprint wires `rawMedia` up once a Path B-compatible vision-
 * extraction transport exists (Sprint 53 dropped photo capture from
 * scope for the identical reason).
 */

/**
 * How the content physically reached AiFA. `in_app_text` is Sprint 53's
 * existing Quick Capture box; the `shared_*`/`forwarded_web` values are
 * Sprint 54's new "Forward to AiFA" web adapter (Vol_5_5 §5 — always
 * owner-forwarded from inside an authenticated session, never a public
 * inbound listener).
 */
export type InputChannel = "in_app_text" | "shared_whatsapp" | "shared_email" | "forwarded_web";

export interface ChannelIntakeMedia {
  mimeType: string;
  bytes: Uint8Array;
}

export interface ChannelIntake {
  channel: InputChannel;
  /** The forwarding owner's own authenticated session context — always the caller, per Vol_5_5 §5, never inferred from message content. */
  businessMembershipId: string;
  rawText: string | null;
  /** Present in the shape per Vol_5_5 §6; always null this sprint — see this file's header. */
  rawMedia: ChannelIntakeMedia[] | null;
  receivedAt: string;
  channelMetadata?: Record<string, unknown>;
}

/** Convenience constructor used by every text-producing adapter (in-app box, Forward-to-AiFA paste). */
export function createTextChannelIntake(params: {
  channel: InputChannel;
  businessMembershipId: string;
  rawText: string;
  channelMetadata?: Record<string, unknown>;
}): ChannelIntake {
  return {
    channel: params.channel,
    businessMembershipId: params.businessMembershipId,
    rawText: params.rawText,
    rawMedia: null,
    receivedAt: new Date().toISOString(),
    channelMetadata: params.channelMetadata,
  };
}
