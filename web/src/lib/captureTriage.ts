/**
 * Capture Triage read helper — Sprint 53 (Vol 5_5 §7). Same "no list
 * RPC needed, RLS scopes the read" pattern as attendanceLeaveCommission.ts
 * and this phase's other lib/*.ts helpers.
 */
import { supabase } from "./supabaseClient";
import type { CaptureTriageItem, CaptureTriageRow } from "@aifa/core/sync/captureTriageTransport";

function toCaptureTriageItem(row: CaptureTriageRow): CaptureTriageItem {
  return {
    id: row.id,
    businessId: row.business_id,
    rawText: row.raw_text,
    detectedDomain: row.detected_domain,
    status: row.status,
    createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at,
  };
}

export async function listCaptureTriage(businessId: string): Promise<CaptureTriageItem[]> {
  const { data, error } = await supabase
    .from("capture_triage")
    .select("*")
    .eq("business_id", businessId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as CaptureTriageRow[]).map(toCaptureTriageItem);
}
