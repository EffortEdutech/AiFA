/**
 * Attendance / Overtime / Leave / Commission read helpers — Sprint 46
 * (Vol 13_0 §11 Module H).
 *
 * Same "no list RPC" reasoning as every other lib/*.ts helper this
 * phase: `attendanceLeaveCommissionTransport.ts` exposes only
 * mutating/lifecycle calls (create-, derive-, grant-, assign-, compute-
 * and mark-prefixed) plus the one deterministic report RPC
 * (`revenueVsCostDashboard`, called directly from the transport, no
 * duplication needed here). RLS scopes every read below correctly —
 * see schema.sql's own policies (~lines 8725/8797/8896/8926/8972/
 * 9076/9121).
 *
 * DISCLOSED GAP — `invoices.agent_party_id`: added by this sprint's
 * own migration (Sprint 35), but `quotationInvoiceTransport.ts`'s
 * `Invoice`/`InvoiceRow` types (Sprint 28) were never updated to
 * expose it, and `assignInvoiceAgent` itself discards the RPC's
 * returned row (typed `Promise<void>`). `getInvoiceAgentPartyId`
 * below reads the column directly — schema-only, same pattern as
 * `delivery_order_lines`/`quotation_lines` elsewhere this phase — since
 * there is genuinely no other way for a client to read back which
 * agent an invoice is assigned to.
 */
import { supabase } from "./supabaseClient";
import type {
  AttendanceRecord,
  AttendanceRecordRow,
  OvertimeRecord,
  OvertimeRecordRow,
  LeaveType,
  LeaveTypeRow,
  LeaveBalance,
  LeaveBalanceRow,
  LeaveApplication,
  LeaveApplicationRow,
  CommissionRule,
  CommissionRuleRow,
  CommissionCalculation,
  CommissionCalculationRow,
} from "@aifa/core/sync/attendanceLeaveCommissionTransport";

function toAttendanceRecord(row: AttendanceRecordRow): AttendanceRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    employeePartyId: row.employee_party_id,
    clockType: row.clock_type,
    recordedAt: row.recorded_at,
    gpsLat: row.gps_lat,
    gpsLng: row.gps_lng,
    gpsAccuracyM: row.gps_accuracy_m,
    source: row.source,
    createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at,
  };
}

function toOvertimeRecord(row: OvertimeRecordRow): OvertimeRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    employeePartyId: row.employee_party_id,
    date: row.date,
    hours: row.hours,
    status: row.status,
    createdAt: row.created_at,
  };
}

function toLeaveType(row: LeaveTypeRow): LeaveType {
  return {
    id: row.id,
    businessId: row.business_id,
    name: row.name,
    defaultEntitlementDays: row.default_entitlement_days,
    createdAt: row.created_at,
  };
}

function toLeaveBalance(row: LeaveBalanceRow): LeaveBalance {
  return {
    employeePartyId: row.employee_party_id,
    leaveTypeId: row.leave_type_id,
    year: row.year,
    entitledDays: row.entitled_days,
    usedDays: row.used_days,
  };
}

function toLeaveApplication(row: LeaveApplicationRow): LeaveApplication {
  return {
    id: row.id,
    businessId: row.business_id,
    employeePartyId: row.employee_party_id,
    leaveTypeId: row.leave_type_id,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    approvedBy: row.approved_by,
    createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at,
  };
}

function toCommissionRule(row: CommissionRuleRow): CommissionRule {
  return {
    id: row.id,
    businessId: row.business_id,
    appliesToPartyId: row.applies_to_party_id,
    basis: row.basis,
    rate: row.rate,
    productScope: row.product_scope,
    createdAt: row.created_at,
  };
}

function toCommissionCalculation(row: CommissionCalculationRow): CommissionCalculation {
  return {
    id: row.id,
    businessId: row.business_id,
    invoiceId: row.invoice_id,
    agentPartyId: row.agent_party_id,
    commissionRuleId: row.commission_rule_id,
    amount: row.amount,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function listAttendanceRecords(businessId: string): Promise<AttendanceRecord[]> {
  const { data, error } = await supabase
    .from("attendance_records")
    .select("*")
    .eq("business_id", businessId)
    .order("recorded_at", { ascending: false });
  if (error) throw error;
  return (data as AttendanceRecordRow[]).map(toAttendanceRecord);
}

export async function listOvertimeRecords(businessId: string): Promise<OvertimeRecord[]> {
  const { data, error } = await supabase
    .from("overtime_records")
    .select("*")
    .eq("business_id", businessId)
    .order("date", { ascending: false });
  if (error) throw error;
  return (data as OvertimeRecordRow[]).map(toOvertimeRecord);
}

export async function listLeaveTypes(businessId: string): Promise<LeaveType[]> {
  const { data, error } = await supabase.from("leave_types").select("*").eq("business_id", businessId).order("name");
  if (error) throw error;
  return (data as LeaveTypeRow[]).map(toLeaveType);
}

/** RLS is scoped via a join to leave_types (leave_balances has no business_id column of its own) — see this file's own header. */
export async function listLeaveBalancesForType(leaveTypeId: string): Promise<LeaveBalance[]> {
  const { data, error } = await supabase.from("leave_balances").select("*").eq("leave_type_id", leaveTypeId);
  if (error) throw error;
  return (data as LeaveBalanceRow[]).map(toLeaveBalance);
}

export async function listLeaveApplications(businessId: string): Promise<LeaveApplication[]> {
  const { data, error } = await supabase
    .from("leave_applications")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as LeaveApplicationRow[]).map(toLeaveApplication);
}

export async function listCommissionRules(businessId: string): Promise<CommissionRule[]> {
  const { data, error } = await supabase
    .from("commission_rules")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as CommissionRuleRow[]).map(toCommissionRule);
}

export async function listCommissionCalculations(businessId: string): Promise<CommissionCalculation[]> {
  const { data, error } = await supabase
    .from("commission_calculations")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as CommissionCalculationRow[]).map(toCommissionCalculation);
}

/** See this file's own header (DISCLOSED GAP) — reads invoices.agent_party_id directly since no transport type exposes it. */
interface InvoiceAgentRow {
  id: string;
  agent_party_id: string | null;
}

export async function listInvoiceAgentAssignments(businessId: string): Promise<Record<string, string | null>> {
  const { data, error } = await supabase.from("invoices").select("id, agent_party_id").eq("business_id", businessId);
  if (error) throw error;
  const result: Record<string, string | null> = {};
  for (const row of data as InvoiceAgentRow[]) {
    result[row.id] = row.agent_party_id;
  }
  return result;
}
