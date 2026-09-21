/**
 * Quick Capture (AI) — Sprint 53 (Phase 5, Vol_5_5 §4/§7), refactored
 * in Sprint 54 to consume the shared `useCaptureRouterCore` hook via a
 * real `ChannelIntake` (Vol_5_5 §6) instead of a bare string, and to
 * render the shared `CaptureResolveForm`/`CaptureTriageList`
 * components instead of its own copy of that JSX.
 *
 * This is the "in_app_text" channel adapter — Vol_5_5 §5's own table
 * lists it as "already built" (Sprint 53's original text box). Sprint
 * 54 did not change what this screen does or how it behaves; it moved
 * the classify+dispatch logic into `useCaptureRouterCore.ts` so the
 * new "Forward to AiFA" screen (`ForwardToAifaPage.tsx`) could call the
 * SAME functions rather than duplicating them — a behaviour-preserving
 * refactor, per Sprint 54's own Risks table.
 *
 * PATH B, NOT PATH A — see Sprint 53's own correction note and
 * Vol_5_5 §3's correction: this deliberately calls the SAME Path B
 * transports (`paymentVouchersReportsTransport.ts`,
 * `attendanceLeaveCommissionTransport.ts`) that the dedicated Expense
 * and Attendance & Leave pages already call, NOT `capturePipeline.ts`.
 *
 * SCOPE: `expense` and `leave_application` only. Anything else lands
 * in the Unclassified Triage list below the form.
 */
import { createTextChannelIntake } from "@aifa/core/ai/channelIntake";

import { useCaptureRouterCore } from "../captureRouter/useCaptureRouterCore";
import { CaptureResolveForm } from "../captureRouter/CaptureResolveForm";
import { CaptureTriageList } from "../captureRouter/CaptureTriageList";

interface Props {
  businessId: string;
  onGoToApprovals?: () => void;
}

export function CaptureRouterPage({ businessId, onGoToApprovals }: Props): JSX.Element {
  const core = useCaptureRouterCore(businessId);

  function buildIntake() {
    return createTextChannelIntake({
      channel: "in_app_text",
      businessMembershipId: businessId,
      rawText: core.rawText,
    });
  }

  if (core.loadError) {
    return (
      <div className="aifa-page">
        <h1>Quick Capture (AI)</h1>
        <p className="error">{core.loadError}</p>
      </div>
    );
  }

  return (
    <div className="aifa-page">
      <h1>Quick Capture (AI)</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Describe what happened in plain text — an expense or a leave application — and let AI figure out which
        screen it belongs on. This is additive to (not a replacement for) the dedicated Expense and Attendance &amp;
        Leave pages, and posts through the exact same calls they do{onGoToApprovals ? (
          <>
            {" "}
            (leave applications open a real approval on the{" "}
            <button onClick={onGoToApprovals} style={{ padding: "0 4px" }}>
              Approvals
            </button>{" "}
            page).
          </>
        ) : (
          "."
        )}{" "}
        Forwarding something from WhatsApp or email instead? Use <strong>Forward to AiFA</strong> in the sidebar.
      </p>

      <div className="card">
        <textarea
          value={core.rawText}
          onChange={(e) => core.setRawText(e.target.value)}
          placeholder='e.g. "Paid RM45 to Grab for petrol" or "Ahmad applying annual leave 2026-09-10 to 2026-09-12"'
          rows={3}
          style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => core.handleDetect(buildIntake())} disabled={!core.rawText.trim()}>
            Detect
          </button>
        </div>

        <CaptureResolveForm core={core} buildIntake={buildIntake} />

        {core.error && <p className="error">{core.error}</p>}
        {core.successMessage && <p className="success">{core.successMessage}</p>}
      </div>

      <CaptureTriageList core={core} />
    </div>
  );
}
