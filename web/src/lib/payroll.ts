/**
 * Employee Profile (non-sensitive columns only) / Payroll Run / Payslip
 * read helpers — Sprint 45 (Vol 13_0 §10 Module G).
 *
 * Same "no list RPC" reasoning as every other lib/*.ts helper this
 * phase: `payrollTransport.ts` exposes only mutating/lifecycle calls
 * (create*, submit*, mark*, generate*) plus the one deterministic
 * utility RPC (`computeStatutoryDeductions`, called directly from the
 * transport, no duplication needed here).
 *
 * SENSITIVE-FIELD BOUNDARY: this file NEVER reads `ic_number`,
 * `epf_number`, `socso_number`, `income_tax_no`, or `bank_account_no`
 * — those columns are encrypted at rest and only ever reach the client
 * plaintext via `getEmployeeProfileDecrypted`, which requires the
 * deployment `encryptionKey` and is called directly from
 * `payrollTransport.ts`, never through this file. `listEmployeeProfiles`
 * below reads exactly the same non-sensitive columns
 * `EmployeeProfileRow` already exposes (bank_name, basic_salary,
 * employment_type, hire_date, resign_date) — see that type's own
 * comment: "encrypted columns omitted — never read directly."
 */
import { supabase } from "./supabaseClient";
import type {
  EmployeeProfile,
  EmployeeProfileRow,
  PayrollRun,
  PayrollRunRow,
  Payslip,
  PayslipRow,
  BulkPaymentFileExport,
  BulkPaymentFileExportRow,
} from "@aifa/core/sync/payrollTransport";

function toEmployeeProfile(row: EmployeeProfileRow): EmployeeProfile {
  return {
    id: row.id,
    businessId: row.business_id,
    partyId: row.party_id,
    bankName: row.bank_name,
    basicSalary: row.basic_salary,
    employmentType: row.employment_type,
    hireDate: row.hire_date,
    resignDate: row.resign_date,
    createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at,
  };
}

function toPayrollRun(row: PayrollRunRow): PayrollRun {
  return {
    id: row.id,
    businessId: row.business_id,
    period: row.period,
    status: row.status,
    totalNetPay: row.total_net_pay,
    createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at,
  };
}

function toPayslip(row: PayslipRow): Payslip {
  return {
    id: row.id,
    payrollRunId: row.payroll_run_id,
    employeePartyId: row.employee_party_id,
    grossPay: row.gross_pay,
    epfEmployee: row.epf_employee,
    epfEmployer: row.epf_employer,
    socsoEmployee: row.socso_employee,
    socsoEmployer: row.socso_employer,
    eisEmployee: row.eis_employee,
    eisEmployer: row.eis_employer,
    pcbDeduction: row.pcb_deduction,
    claimsIncluded: row.claims_included,
    advanceDeducted: row.advance_deducted,
    netPay: row.net_pay,
    ePayslipSentAt: row.e_payslip_sent_at,
    ePayslipChannel: row.e_payslip_channel,
    createdAt: row.created_at,
  };
}

export async function listEmployeeProfiles(businessId: string): Promise<EmployeeProfile[]> {
  const { data, error } = await supabase
    .from("employee_profiles")
    .select("id, business_id, party_id, bank_name, basic_salary, employment_type, hire_date, resign_date, created_by_membership_id, created_at")
    .eq("business_id", businessId)
    .order("hire_date", { ascending: false });
  if (error) throw error;
  return (data as EmployeeProfileRow[]).map(toEmployeeProfile);
}

export async function listPayrollRuns(businessId: string): Promise<PayrollRun[]> {
  const { data, error } = await supabase
    .from("payroll_runs")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as PayrollRunRow[]).map(toPayrollRun);
}

export async function listPayslips(payrollRunId: string): Promise<Payslip[]> {
  const { data, error } = await supabase
    .from("payslips")
    .select("*")
    .eq("payroll_run_id", payrollRunId);
  if (error) throw error;
  return (data as PayslipRow[]).map(toPayslip);
}

function toBulkPaymentFileExport(row: BulkPaymentFileExportRow): BulkPaymentFileExport {
  return {
    id: row.id,
    payrollRunId: row.payroll_run_id,
    bankFormat: row.bank_format,
    fileRef: row.file_ref,
    fileContent: row.file_content,
    createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at,
  };
}

/** At most one per PayrollRun in practice (`generateBulkPaymentFileExport` throws on a second call for the same run), but this reads the table as-is rather than assuming that invariant client-side. */
export async function listBulkPaymentFileExports(payrollRunId: string): Promise<BulkPaymentFileExport[]> {
  const { data, error } = await supabase
    .from("bulk_payment_file_exports")
    .select("*")
    .eq("payroll_run_id", payrollRunId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as BulkPaymentFileExportRow[]).map(toBulkPaymentFileExport);
}
