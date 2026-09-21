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
 */
import { useRef, useState } from "react";

import { createTextChannelIntake } from "@aifa/core/ai/channelIntake";
import type { InputChannel } from "@aifa/core/ai/channelIntake";

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
        <h1>Forward to AiFA</h1>
        <p className="error">{core.loadError}</p>
      </div>
    );
  }

  return (
    <div className="aifa-page">
      <h1>Forward to AiFA</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Got something business-relevant on WhatsApp or email? Paste the forwarded text, drop a receipt/invoice
        image or PDF, or upload a voice note below — this goes through the exact same AI classification and
        posting as <strong>Quick Capture (AI)</strong>
        {onGoToApprovals ? (
          <>
            {" "}
            (leave applications open a real approval on the{" "}
            <button onClick={onGoToApprovals} style={{ padding: "0 4px" }}>
              Approvals
            </button>{" "}
            page)
          </>
        ) : null}
        . Nothing here ever comes from an unattended inbox — only what you personally choose to paste/drop in.
      </p>

      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <label>
            Where did this come from?{" "}
            <select
              value={sourceChannel}
              onChange={(e) => setSourceChannel(e.target.value as InputChannel)}
              style={{ padding: 6 }}
            >
              {FORWARD_SOURCES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <textarea
          value={core.rawText}
          onChange={(e) => core.setRawText(e.target.value)}
          placeholder="Paste the forwarded message text here…"
          rows={4}
          style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
        />

        <div
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
          className="muted"
          style={{
            marginTop: 8,
            padding: 16,
            border: "1px dashed var(--border-color, #999)",
            borderRadius: 6,
            textAlign: "center",
            opacity: dragOver ? 0.6 : 1,
          }}
        >
          Drop a forwarded receipt/invoice image or PDF here, or{" "}
          <label style={{ textDecoration: "underline", cursor: "pointer" }}>
            browse
            <input
              type="file"
              accept="image/*,application/pdf"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = "";
              }}
            />
          </label>
          .
          {core.mediaStatus === "extracting" && <div>Reading the file…</div>}
          {core.mediaStatus === "failed" && (
            <div className="error" style={{ marginTop: 4 }}>
              Couldn't read this file — a vision-capable connection isn't available yet on web (this needs the AI
              Gateway's image-support route, still being built). Paste a text description above instead for now.
            </div>
          )}
        </div>

        <div className="row" style={{ marginTop: 8, alignItems: "center", gap: 8 }}>
          <label className="muted">
            Voice note:{" "}
            <button type="button" onClick={() => voiceInputRef.current?.click()}>
              Upload
            </button>
          </label>
          <input
            ref={voiceInputRef}
            type="file"
            accept="audio/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleVoiceFile(file);
              e.target.value = "";
            }}
          />
          {core.voiceStatus === "transcribing" && <span className="muted">Transcribing…</span>}
          {core.voiceStatus === "not_configured" && (
            <span className="muted">
              Voice transcription isn't set up yet — no speech-to-text provider is configured. This is a real
              vendor decision still to be made, not a bug.
            </span>
          )}
          {core.voiceStatus === "failed" && <span className="error">Couldn't transcribe this recording.</span>}
        </div>

        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => core.handleDetect(buildIntake())} disabled={!core.rawText.trim()}>
            Detect
          </button>
        </div>

        {core.mediaHint && <p className="muted" style={{ marginTop: 8 }}>{core.mediaHint}</p>}

        <CaptureResolveForm core={core} buildIntake={buildIntake} />

        {core.error && <p className="error">{core.error}</p>}
        {core.successMessage && <p className="success">{core.successMessage}</p>}
      </div>

      <CaptureTriageList core={core} />
    </div>
  );
}
