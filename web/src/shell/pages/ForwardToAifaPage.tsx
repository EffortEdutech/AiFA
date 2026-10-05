/**
 * Forward to AiFA — Sprint 54 (Phase 5, Vol_5_5 §5/§6), extended in
 * Sprint 55 (Universal Media & Voice Intake Foundation) with real
 * image/PDF and voice-note support.
 *
 * The first genuinely new channel adapter: an owner pastes text (or now,
 * drops an image/PDF, or uploads a voice note) they forwarded to
 * themselves from WhatsApp or email, tags which one it came from
 * (cosmetic provenance only — Vol_5_5 §6 `channelMetadata`), and it flows
 * through the EXACT SAME classify+dispatch core (`useCaptureRouterCore`)
 * as the in-app Quick Capture screen.
 *
 * Trust boundary (Vol_5_5 §5, restated not re-litigated): this content
 * only ever arrives inside the owner's own authenticated session —
 * there is no public inbound listener, no sender verification beyond
 * that session. The act of pasting/dropping it here IS the owner's
 * approval to look at it.
 *
 * SPRINT 55 MEDIA/VOICE STATUS — read before assuming this "just works":
 * - Image extraction reuses the real, tested vision call (Sprint 5/6),
 *   now reachable on web via the Gateway's `/ai-vision` route — WHICH
 *   DOES NOT EXIST YET (see `gatewayProvider.ts`'s header for the full
 *   contract). Every drop will fail with an honest "couldn't read this"
 *   message until that route ships on the Gateway side (a separate repo).
 * - PDF extraction additionally needs the real Anthropic "document"
 *   content-block branch this sprint added to `anthropicProvider.ts` —
 *   real, but unexercised by any test suite (needs a live key + network).
 * - Voice transcription has NO configured provider at all yet (neither
 *   shipped provider implements `transcribeAudio` — see types.ts) — this
 *   is an honest "not configured" state, not a bug, until a real
 *   speech-to-text vendor is chosen.
 * None of this is silently faked: every one of these paths shows its own
 * honest status rather than pretending to have worked.
 *
 * UI polish Phase 4: presentation only — shared header, card, labelled
 * fields and buttons, a keyboard-reachable drop zone. Same handlers.
 */
import { useRef, useState } from "react";

import { createTextChannelIntake } from "@aifa/core/ai/channelIntake";
import type { InputChannel } from "@aifa/core/ai/channelIntake";

import { Button, Card, Field, PageHeader } from "../../ui";
import { useCaptureRouterCore } from "../captureRouter/useCaptureRouterCore";
import { CaptureResolveForm } from "../captureRouter/CaptureResolveForm";
import { CaptureTriageList } from "../captureRouter/CaptureTriageList";

interface Props {
  businessId: string;
  onGoToApprovals?: () => void;
}

const FORWARD_SOURCES: { value: InputChannel; label: string }[] = [
  { value: "shared_whatsapp", label: "Forwarded from WhatsApp" },
  { value: "shared_email", label: "Forwarded from Email" },
  { value: "forwarded_web", label: "Other / not sure" },
];

/** Strips the `data:<mime>;base64,` prefix FileReader.readAsDataURL adds — providers want raw base64. */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export function ForwardToAifaPage({ businessId, onGoToApprovals }: Props): JSX.Element {
  const core = useCaptureRouterCore(businessId);
  const [sourceChannel, setSourceChannel] = useState<InputChannel>("shared_whatsapp");
  const [dragOver, setDragOver] = useState(false);
  const voiceInputRef = useRef<HTMLInputElement | null>(null);

  function buildIntake() {
    return createTextChannelIntake({
      channel: sourceChannel,
      businessMembershipId: businessId,
      rawText: core.rawText,
      channelMetadata: { source: sourceChannel },
    });
  }

  async function handleFile(file: File): Promise<void> {
    const kind: "image" | "pdf" = file.type === "application/pdf" ? "pdf" : "image";
    if (kind === "image" && !file.type.startsWith("image/")) {
      // Not an image or a PDF (e.g. a forwarded contact card / location pin) — Sprint 54's Risk table:
      // anything that doesn't cleanly map falls to unclassified, never a crash or silent no-op.
      core.setRawText(`(unsupported forwarded file: ${file.name || file.type || "unknown type"})`);
      core.handleDetect(buildIntake());
      return;
    }
    try {
      const base64Data = await readFileAsBase64(file);
      await core.handleDetectMedia({ base64Data, mimeType: file.type || "image/jpeg", kind });
    } catch {
      // Couldn't even read the file off disk (rare) — fall back to the honest unclassified path
      // rather than calling the extraction API with garbage data.
      core.setRawText(`(could not read the dropped file: ${file.name || "unknown"})`);
      core.handleDetect(buildIntake());
    }
  }

  async function handleVoiceFile(file: File): Promise<void> {
    const base64Data = await readFileAsBase64(file);
    await core.handleDetectVoice({ base64Data, mimeType: file.type || "audio/mpeg" }, sourceChannel);
  }

  if (core.loadError) {
    return (
      <div className="aifa-page">
        <PageHeader title="Forward to AiFA" />
        <p className="aifa-alert aifa-alert--danger" role="alert">
          {core.loadError}
        </p>
      </div>
    );
  }

  return (
    <div className="aifa-page">
      <PageHeader
        title="Forward to AiFA"
        description="Got something business-relevant on WhatsApp or email? Paste the forwarded text, drop a receipt/invoice image or PDF, or upload a voice note."
      />
      <p className="ui-muted" style={{ marginTop: 0 }}>
        This goes through the exact same AI classification and posting as <strong>Quick Capture (AI)</strong>
        {onGoToApprovals ? (
          <>
            {" "}
            (leave applications open a real approval on the{" "}
            <button type="button" className="aifa-link-btn" onClick={onGoToApprovals}>
              Approvals
            </button>{" "}
            page)
          </>
        ) : null}
        . Nothing here ever comes from an unattended inbox — only what you personally choose to paste/drop in.
      </p>

      <Card>
        <div className="ui-form-grid">
          <Field label="Where did this come from?">
            {(p) => (
              <select
                {...p}
                className="ui-select"
                value={sourceChannel}
                onChange={(e) => setSourceChannel(e.target.value as InputChannel)}
              >
                {FORWARD_SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <div style={{ marginTop: "var(--aifa-space-4)" }}>
          <Field label="Forwarded message text">
            {(p) => (
              <textarea
                {...p}
                className="ui-textarea"
                value={core.rawText}
                onChange={(e) => core.setRawText(e.target.value)}
                placeholder="Paste the forwarded message text here…"
                rows={4}
              />
            )}
          </Field>
        </div>

        <div
          className={`ui-dropzone${dragOver ? " is-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
        >
          <span>Drop a forwarded receipt/invoice image or PDF here, or </span>
          <label className="ui-dropzone__browse">
            browse
            <input
              type="file"
              className="ui-visually-hidden"
              accept="image/*,application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
          </label>
          <span>.</span>
          {core.mediaStatus === "extracting" && (
            <div role="status" className="ui-note">
              Reading the file…
            </div>
          )}
          {core.mediaStatus === "failed" && (
            <p className="aifa-alert aifa-alert--danger" role="alert" style={{ textAlign: "left" }}>
              Couldn't read this file — a vision-capable connection isn't available yet on web (this needs the AI
              Gateway's image-support route, still being built). Paste a text description above instead for now.
            </p>
          )}
        </div>

        <div className="ui-inline-actions" style={{ marginTop: "var(--aifa-space-3)" }}>
          <span className="ui-muted">Voice note:</span>
          <Button size="sm" variant="secondary" onClick={() => voiceInputRef.current?.click()}>
            Upload
          </Button>
          <input
            ref={voiceInputRef}
            type="file"
            className="ui-visually-hidden"
            accept="audio/*"
            aria-label="Upload a voice note"
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleVoiceFile(file);
              e.target.value = "";
            }}
          />
          {core.voiceStatus === "transcribing" && (
            <span className="ui-muted" role="status">
              Transcribing…
            </span>
          )}
          {core.voiceStatus === "not_configured" && (
            <span className="ui-muted">
              Voice transcription isn't set up yet — no speech-to-text provider is configured. This is a real
              vendor decision still to be made, not a bug.
            </span>
          )}
          {core.voiceStatus === "failed" && (
            <span className="aifa-alert aifa-alert--danger" role="alert">
              Couldn't transcribe this recording.
            </span>
          )}
        </div>

        <div className="ui-form-actions">
          <Button variant="primary" onClick={() => core.handleDetect(buildIntake())} disabled={!core.rawText.trim()}>
            Detect
          </Button>
        </div>

        {core.mediaHint && <p className="ui-note">{core.mediaHint}</p>}

        <CaptureResolveForm core={core} buildIntake={buildIntake} />

        {core.error && (
          <p className="aifa-alert aifa-alert--danger" role="alert">
            {core.error}
          </p>
        )}
        {core.successMessage && (
          <p className="aifa-alert aifa-alert--success" role="status">
            {core.successMessage}
          </p>
        )}
      </Card>

      <CaptureTriageList core={core} />
    </div>
  );
}
