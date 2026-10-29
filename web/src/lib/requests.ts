/**
 * Customer requests (Sprint 68b/68c) -- the Sales -> Requests inbox.
 *
 * Reads go straight to the tables (row-level security lets only members who
 * hold sales:view see them). Every change goes through a SECURITY DEFINER
 * function from migration 22, which checks sales:capture and records a
 * timeline event, so the browser can never forge history.
 */
import { supabase } from "./supabaseClient";

export type RequestStatus = "new" | "seen" | "replied" | "quoted" | "closed" | "spam";
export type RequestKind = "contact" | "rfq" | "po";

export interface RequestItem {
  description: string;
  quantity: string;
}

export interface CustomerRequest {
  id: string;
  businessId: string;
  requestType: RequestKind;
  status: RequestStatus;
  referenceCode: string;
  trackingToken: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  source: string | null;
  message: string;
  items: RequestItem[];
  neededBy: string | null;
  deliveryArea: string | null;
  quotationId: string | null;
  createdAt: string;
  seenAt: string | null;
  closedAt: string | null;
}

export interface RequestEvent {
  id: string;
  requestId: string;
  kind: "received" | "seen" | "status" | "reply" | "note" | "quotation";
  status: string | null;
  body: string | null;
  isPublic: boolean;
  createdAt: string;
}

type Row = Record<string, unknown>;

function toRequest(r: Row): CustomerRequest {
  const payload = (r.payload ?? {}) as Row;
  const items = Array.isArray(payload.items) ? (payload.items as Row[]) : [];
  return {
    id: r.id as string,
    businessId: r.business_id as string,
    requestType: r.request_type as RequestKind,
    status: r.status as RequestStatus,
    referenceCode: (r.reference_code as string) ?? "",
    trackingToken: (r.tracking_token as string) ?? "",
    customerName: (r.customer_name as string) || "Customer",
    customerPhone: (r.customer_phone as string | null) ?? null,
    customerEmail: (r.customer_email as string | null) ?? null,
    source: (r.source as string | null) ?? null,
    message: typeof payload.message === "string" ? payload.message : "",
    items: items.map((i) => ({ description: String(i.description ?? ""), quantity: String(i.quantity ?? "") })),
    neededBy: typeof payload.needed_by === "string" ? payload.needed_by : null,
    deliveryArea: typeof payload.delivery_area === "string" ? payload.delivery_area : null,
    quotationId: (r.quotation_id as string | null) ?? null,
    createdAt: r.created_at as string,
    seenAt: (r.seen_at as string | null) ?? null,
    closedAt: (r.closed_at as string | null) ?? null,
  };
}

export async function listRequests(businessId: string): Promise<CustomerRequest[]> {
  const { data, error } = await supabase
    .from("requests")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return ((data ?? []) as Row[]).map(toRequest);
}

/** How many requests are waiting, unseen. Returns 0 when the caller may not read them. */
export async function countNewRequests(businessId: string): Promise<number> {
  const { data, error } = await supabase
    .from("requests")
    .select("id")
    .eq("business_id", businessId)
    .eq("status", "new");
  if (error) return 0;
  return ((data ?? []) as Row[]).length;
}

export async function listRequestEvents(requestId: string): Promise<RequestEvent[]> {
  const { data, error } = await supabase
    .from("request_status_events")
    .select("*")
    .eq("request_id", requestId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Row[]).map((e) => ({
    id: e.id as string,
    requestId: e.request_id as string,
    kind: e.kind as RequestEvent["kind"],
    status: (e.status as string | null) ?? null,
    body: (e.body as string | null) ?? null,
    isPublic: Boolean(e.is_public),
    createdAt: e.created_at as string,
  }));
}

async function call(fn: string, args: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc(fn, args);
  if (error) throw error;
}

export const markRequestSeen = (id: string) => call("mark_request_seen", { p_request_id: id });
export const replyToRequest = (id: string, body: string) => call("reply_to_request", { p_request_id: id, p_body: body });
export const setRequestStatus = (id: string, status: "new" | "seen" | "replied" | "closed" | "spam") =>
  call("set_request_status", { p_request_id: id, p_status: status });
export const addRequestNote = (id: string, body: string) => call("add_request_note", { p_request_id: id, p_body: body });
export const linkRequestQuotation = (id: string, quotationId: string) =>
  call("link_request_quotation", { p_request_id: id, p_quotation_id: quotationId });

/** Plain-language text for the error codes the functions raise. */
export function requestErrorMessage(err: unknown, fallback: string): string {
  const text = err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : "";
  if (text.includes("request_not_found")) return "You do not have permission to change this request.";
  if (text.includes("invalid_reply")) return "Write a reply of 1 to 2000 characters.";
  if (text.includes("invalid_note")) return "Write a note of 1 to 2000 characters.";
  if (text.includes("request_is_spam")) return "This request is marked as spam. Reopen it first.";
  if (text.includes("quotation_not_found")) return "That quotation could not be found for this business.";
  return text || fallback;
}
