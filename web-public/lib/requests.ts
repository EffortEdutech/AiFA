// Server-side helpers for customer requests (Sprint 68a).
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Salted SHA-256 of the sender's IP, hex. Used only so the database can count
 * recent submissions per sender; the raw IP is never stored or logged.
 * REQUEST_IP_SALT should be set in Vercel; the fallback keeps local dev working.
 */
export function hashIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const salt = process.env.REQUEST_IP_SALT || "aifa-dev-salt";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/** Plain-language messages for the error codes raised by submit_public_request_v2. */
export const REQUEST_ERRORS: Record<string, string> = {
  invalid_name: "Please enter your name (at least 2 characters).",
  invalid_phone: "Please enter a phone number we can reach you on, e.g. 012-345 6789.",
  invalid_email: "That email address does not look right. You can also leave it blank.",
  invalid_message: "Please write a message of at least 10 characters.",
  too_many_links: "Please keep links out of the message (2 at most).",
  consent_required: "Please tick the box so we can contact you about this request.",
  invalid_items: "Please list between 1 and 10 items, each with a short description.",
  invalid_needed_by: "The needed-by date cannot be in the past.",
  invalid_delivery_area: "The delivery area is too long.",
  rate_limited: "You have sent several requests recently. Please try again in about an hour.",
  request_failed: "We could not send your request. Please try again.",
};

export const STATUS_LABELS: Record<string, string> = {
  new: "Received",
  seen: "Seen by the business",
  replied: "Replied",
  quoted: "Quotation prepared",
  closed: "Closed",
};
