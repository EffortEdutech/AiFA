/**
 * Attendance, Leave & Commission — Sprint 35 (Vol 13_0 §11 Module H:
 * Pengurusan Syarikat Lengkap). Continues Sub-phase 3e.
 *
 * Mirrors payrollTransport.ts / eInvoiceSstTransport.ts's own shape in
 * this same directory.
 *
 * ============================================================
 * GPS / OFFLINE NOTE: `createAttendanceRecord` takes an explicit
 * `recordedAt` rather than always sending "now" — the app should pass
 * the true device clock-in/out time even when the record was captured
 * offline and is only being synced now (see the migration's own
 * header note 1). This transport does NOT implement the offline
 * queue itself — Vol 13_0 §11's own domain-flow text says attendance
 * capture reuses Vol 7_4's existing offline-capture/queue pattern
 * unmodified; nothing new is needed here for that. A real airplane-
 * mode/on-device verification of that existing queue is outside what
 * this session's tooling can perform — disclosed, not silently
 * assumed. See the Sprint 35 doc's Outcomes.
 *
 * OVERTIME PAY NOTE: `hourly_rate = basic_salary / (26 * 8)`, at 1.5x
 * for overtime hours, is an assumed common Malaysian payroll
 * convention baked into `createPayrollRun` server-side (Sprint 34's
 * function, re-defined this sprint) — Vol 13_0 §11 specifies neither
 * constant. Statutory deductions (see payrollTransport.ts) are
 * computed against the OT-inclusive gross_pay, matching real-world
 * statutory treatment of overtime pay.
 *
 * COMMISSION TRIGGER NOTE: `computeCommissionForInvoice` must be
 * called explicitly by the client immediately after the action that
 * moves an Invoice to the business's configured
 * `commission_trigger_status` ('issued' or 'paid') — there is no
 * hidden database trigger on `invoices`. Calling it before an agent
 * has been assigned (`assignInvoiceAgent`), before the invoice has
 * reached that status, or twice for the same invoice all throw.
 * ============================================================
 */

/** See supabaseTransport.ts's own header comment for why this exists instead of importing `SupabaseClient` from `@supabase/supabase-js` directly. */
export interface SupabaseClientLike {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type ClockType = "in" | "out";
export type AttendanceSource = "mobile_app" | "manual_admin_entry";
export type OvertimeStatus = "draft" | "approved" | "synced_to_payroll";
export type LeaveApplicationStatus = "pending_approval" | "approved" | "rejected";
export type CommissionBasis = "percent_of_invoice" | "percent_of_margin" | "flat_per_unit";
export type CommissionCalculationStatus = "computed" | "approved" | "paid";
export type CommissionTriggerStatus = "issued" | "paid";

/** Row shape of public.attendance_records. */
export interface AttendanceRecordRow {
  id: string;
  business_id: string;
  employee_party_id: string;
  clock_type: ClockType;
  recorded_at: string;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy_m: number | null;
  source: AttendanceSource;
  created_by_membership_id: string | null;
  created_at: string;
}

export interface AttendanceRecord {
  id: string;
  businessId: string;
  employeePartyId: string;
  clockType: ClockType;
  recordedAt: string;
  gpsLat: number | null;
  gpsLng: number | null;
  gpsAccuracyM: number | null;
  source: AttendanceSource;
  createdByMembershipId: string | null;
  createdAt: string;
}

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

/** Row shape of public.overtime_records. */
export interface OvertimeRecordRow {
  id: string;
  business_id: string;
  employee_party_id: string;
  date: string;
  hours: number;
  status: OvertimeStatus;
  created_at: string;
}

export interface OvertimeRecord {
  id: string;
  businessId: string;
  employeePartyId: string;
  date: string;
  hours: number;
  status: OvertimeStatus;
  createdAt: string;
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

/** Row shape of public.leave_types. */
export interface LeaveTypeRow {
  id: string;
  business_id: string;
  name: string;
  default_entitlement_days: number;
  created_at: string;
}

export interface LeaveType {
  id: string;
  businessId: string;
  name: string;
  defaultEntitlementDays: number;
  createdAt: string;
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

/** Row shape of public.leave_balances. */
export interface LeaveBalanceRow {
  employee_party_id: string;
  leave_type_id: string;
  year: number;
  entitled_days: number;
  used_days: number;
}

export interface LeaveBalance {
  employeePartyId: string;
  leaveTypeId: string;
  year: number;
  entitledDays: number;
  usedDays: number;
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

/** Row shape of public.leave_applications. */
export interface LeaveApplicationRow {
  id: string;
  business_id: string;
  employee_party_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  status: LeaveApplicationStatus;
  approved_by: string | null;
  created_by_membership_id: string | null;
  created_at: string;
}

export interface LeaveApplication {
  id: string;
  businessId: string;
  employeePartyId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  status: LeaveApplicationStatus;
  approvedBy: string | null;
  createdByMembershipId: string | null;
  createdAt: string;
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

/** Row shape of public.commission_rules. */
export interface CommissionRuleRow {
  id: string;
  business_id: string;
  applies_to_party_id: string | null;
  basis: CommissionBasis;
  rate: number;
  product_scope: string | null;
  created_at: string;
}

export interface CommissionRule {
  id: string;
  businessId: string;
  /** null = business-wide default rule, used when the invoice's agent has no rule of their own. */
  appliesToPartyId: string | null;
  basis: CommissionBasis;
  rate: number;
  productScope: string | null;
  createdAt: string;
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

/** Row shape of public.commission_calculations. */
export interface CommissionCalculationRow {
  id: string;
  business_id: string;
  invoice_id: string;
  agent_party_id: string;
  commission_rule_id: string;
  amount: number;
  status: CommissionCalculationStatus;
  created_at: string;
}

export interface CommissionCalculation {
  id: string;
  businessId: string;
  invoiceId: string;
  agentPartyId: string;
  commissionRuleId: string;
  amount: number;
  status: CommissionCalculationStatus;
  createdAt: string;
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

/** Row shape of revenue_vs_cost_dashboard's result. */
export interface RevenueVsCostDashboardRow {
  revenue: number;
  payroll_cost: number;
  commission_cost: number;
  net: number;
}

export interface RevenueVsCostDashboard {
  revenue: number;
  payrollCost: number;
  commissionCost: number;
  net: number;
}

function toRevenueVsCostDashboard(row: RevenueVsCostDashboardRow): RevenueVsCostDashboard {
  return {
    revenue: row.revenue,
    payrollCost: row.payroll_cost,
    commissionCost: row.commission_cost,
    net: row.net,
  };
}

export interface SupabaseAttendanceLeaveCommissionTransport {
  /** `capture` on `sales`. Assigns the agent Party a commission should be attributed to once computed. */
  assignInvoiceAgent(invoiceId: string, agentPartyId: string): Promise<void>;

  /** `capture` on `hr_attendance_leave`. Records a clock-in/out event. Rejects two consecutive same-type events for the same employee (an employee's first-ever record must be 'in'). `recordedAt` is stored as given — never forced to "now" — so an offline-captured event synced later still carries its true clock time. */
  createAttendanceRecord(params: {
    businessId: string;
    employeePartyId: string;
    clockType: ClockType;
    recordedAt: string;
    gpsLat?: number | null;
    gpsLng?: number | null;
    gpsAccuracyM?: number | null;
    source?: AttendanceSource;
  }): Promise<AttendanceRecord>;

  /** `capture` on `hr_attendance_leave`. Pairs an employee's in/out attendance records for the given calendar date, sums worked hours, and drafts an OvertimeRecord (opening its own ApprovalTask) if worked hours exceed `scheduledHours` (default 8 — pass an explicit value for a part-time or otherwise irregular schedule). Throws if there is no overtime, or if this employee/date has already been derived. Does not handle a shift spanning midnight. */
  deriveOvertimeForDate(params: {
    businessId: string;
    employeePartyId: string;
    date: string;
    scheduledHours?: number;
  }): Promise<OvertimeRecord>;

  /** `configure` on `hr_attendance_leave`. Defines a reusable leave type (e.g. "Annual Leave") with its default entitlement. */
  createLeaveType(params: { businessId: string; name: string; defaultEntitlementDays: number }): Promise<LeaveType>;

  /** `configure` on `hr_attendance_leave`. Grants (or updates) an employee's leave balance for a given type/year. Entitled days default to the leave type's own `defaultEntitlementDays` unless overridden. */
  grantLeaveBalance(params: {
    employeePartyId: string;
    leaveTypeId: string;
    year: number;
    entitledDays?: number | null;
  }): Promise<LeaveBalance>;

  /** `capture` on `hr_attendance_leave`. Submits a leave application, opening its own ApprovalTask. Throws `insufficient_leave_balance` if the requested (inclusive) day count exceeds what remains for that employee/type/year. Balance is NOT deducted here — only on approval. */
  createLeaveApplication(params: {
    businessId: string;
    employeePartyId: string;
    leaveTypeId: string;
    startDate: string;
    endDate: string;
  }): Promise<LeaveApplication>;

  /** `configure` on `commission`. Defines a commission rule — either agent-specific (`appliesToPartyId` set) or the business-wide default (omitted/null), used as the fallback for an agent with no rule of their own. */
  createCommissionRule(params: {
    businessId: string;
    basis: CommissionBasis;
    rate: number;
    appliesToPartyId?: string | null;
    productScope?: string | null;
  }): Promise<CommissionRule>;

  /** `capture` on `commission`. Computes and opens an ApprovalTask for a CommissionCalculation on an invoice, resolving the agent-specific rule first and the business-wide default rule as fallback. Throws if the invoice hasn't reached the business's configured `commissionTriggerStatus`, has no assigned agent, has already been computed, or no rule (specific or default) exists. Call this explicitly right after the action that moves the invoice to the configured trigger status — there is no automatic database trigger. */
  computeCommissionForInvoice(invoiceId: string): Promise<CommissionCalculation>;

  /** `capture` on `commission`. Marks an 'approved' CommissionCalculation as 'paid'. Throws if not yet approved. */
  markCommissionPaid(commissionCalculationId: string): Promise<CommissionCalculation>;

  /** `view` on `accounting_reports`. Read-only revenue-vs-payroll-vs-commission-cost summary for a date range — no new storage, the functional minimum this sprint's own plan names. Payroll cost sums PayrollRuns whose period falls in the requested range and whose status is 'approved' or 'paid'; commission cost sums CommissionCalculations computed in range with the same two statuses. */
  revenueVsCostDashboard(businessId: string, dateFrom: string, dateTo: string): Promise<RevenueVsCostDashboard>;
}

export function createSupabaseAttendanceLeaveCommissionTransport(
  client: SupabaseClientLike,
): SupabaseAttendanceLeaveCommissionTransport {
  return {
    async assignInvoiceAgent(invoiceId, agentPartyId) {
      const { error } = await client.rpc("assign_invoice_agent", {
        p_invoice_id: invoiceId,
        p_agent_party_id: agentPartyId,
      });
      if (error) throw error;
    },

    async createAttendanceRecord(params) {
      const { data, error } = await client.rpc("create_attendance_record", {
        p_business_id: params.businessId,
        p_employee_party_id: params.employeePartyId,
        p_clock_type: params.clockType,
        p_recorded_at: params.recordedAt,
        p_gps_lat: params.gpsLat ?? null,
        p_gps_lng: params.gpsLng ?? null,
        p_gps_accuracy_m: params.gpsAccuracyM ?? null,
        p_source: params.source ?? "mobile_app",
      });
      if (error) throw error;
      const rows = data as AttendanceRecordRow[];
      return toAttendanceRecord(rows[0]);
    },

    async deriveOvertimeForDate(params) {
      const { data, error } = await client.rpc("derive_overtime_for_date", {
        p_business_id: params.businessId,
        p_employee_party_id: params.employeePartyId,
        p_date: params.date,
        p_scheduled_hours: params.scheduledHours ?? 8,
      });
      if (error) throw error;
      const rows = data as OvertimeRecordRow[];
      return toOvertimeRecord(rows[0]);
    },

    async createLeaveType(params) {
      const { data, error } = await client.rpc("create_leave_type", {
        p_business_id: params.businessId,
        p_name: params.name,
        p_default_entitlement_days: params.defaultEntitlementDays,
      });
      if (error) throw error;
      const rows = data as LeaveTypeRow[];
      return toLeaveType(rows[0]);
    },

    async grantLeaveBalance(params) {
      const { data, error } = await client.rpc("grant_leave_balance", {
        p_employee_party_id: params.employeePartyId,
        p_leave_type_id: params.leaveTypeId,
        p_year: params.year,
        p_entitled_days: params.entitledDays ?? null,
      });
      if (error) throw error;
      const rows = data as LeaveBalanceRow[];
      return toLeaveBalance(rows[0]);
    },

    async createLeaveApplication(params) {
      const { data, error } = await client.rpc("create_leave_application", {
        p_business_id: params.businessId,
        p_employee_party_id: params.employeePartyId,
        p_leave_type_id: params.leaveTypeId,
        p_start_date: params.startDate,
        p_end_date: params.endDate,
      });
      if (error) throw error;
      const rows = data as LeaveApplicationRow[];
      return toLeaveApplication(rows[0]);
    },

    async createCommissionRule(params) {
      const { data, error } = await client.rpc("create_commission_rule", {
        p_business_id: params.businessId,
        p_basis: params.basis,
        p_rate: params.rate,
        p_applies_to_party_id: params.appliesToPartyId ?? null,
        p_product_scope: params.productScope ?? null,
      });
      if (error) throw error;
      const rows = data as CommissionRuleRow[];
      return toCommissionRule(rows[0]);
    },

    async computeCommissionForInvoice(invoiceId) {
      const { data, error } = await client.rpc("compute_commission_for_invoice", {
        p_invoice_id: invoiceId,
      });
      if (error) throw error;
      const rows = data as CommissionCalculationRow[];
      return toCommissionCalculation(rows[0]);
    },

    async markCommissionPaid(commissionCalculationId) {
      const { data, error } = await client.rpc("mark_commission_paid", {
        p_commission_calculation_id: commissionCalculationId,
      });
      if (error) throw error;
      const rows = data as CommissionCalculationRow[];
      return toCommissionCalculation(rows[0]);
    },

    async revenueVsCostDashboard(businessId, dateFrom, dateTo) {
      const { data, error } = await client.rpc("revenue_vs_cost_dashboard", {
        p_business_id: businessId,
        p_date_from: dateFrom,
        p_date_to: dateTo,
      });
      if (error) throw error;
      const rows = data as RevenueVsCostDashboardRow[];
      return toRevenueVsCostDashboard(rows[0]);
    },
  };
}
