import { humanizeStatus } from "./format";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

/**
 * One status-to-tone map for the whole console, so "draft", "paid" or
 * "rejected" looks the same on every page. Unknown codes fall back to
 * neutral rather than guessing a meaning.
 */
const TONE_BY_STATUS: Record<string, StatusTone> = {
  draft: "neutral",
  inactive: "neutral",
  cancelled: "neutral",
  void: "neutral",
  voided: "neutral",
  sent: "info",
  submitted: "info",
  issued: "info",
  open: "info",
  partial: "info",
  partially_paid: "info",
  pending: "warning",
  pending_approval: "warning",
  expired: "warning",
  due: "warning",
  overdue: "danger",
  accepted: "success",
  approved: "success",
  active: "success",
  paid: "success",
  posted: "success",
  validated: "success",
  completed: "success",
  delivered: "success",
  converted_to_invoice: "success",
  rejected: "danger",
  failed: "danger",
  declined: "danger",
  suspended: "danger",
};

export function statusTone(status: string): StatusTone {
  return TONE_BY_STATUS[status.toLowerCase()] ?? "neutral";
}

interface StatusPillProps {
  /** Raw status code as stored, e.g. "converted_to_invoice". */
  status: string;
  /** Override the shown text; the tone still comes from `status`. */
  label?: string;
  tone?: StatusTone;
}

export function StatusPill({ status, label, tone }: StatusPillProps): JSX.Element {
  const resolved = tone ?? statusTone(status);
  return <span className={`ui-pill ui-pill--${resolved}`}>{label ?? humanizeStatus(status)}</span>;
}
