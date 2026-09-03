/**
 * Payroll & Statutory Contributions — Sprint 34 (Vol 13_0 §10 Module
 * G: Payroll & Penggajian). Opens Sub-phase 3e.
 *
 * Mirrors eInvoiceSstTransport.ts / fullAccountingReportsTransport.ts's
 * own shape in this same directory.
 *
 * ============================================================
 * ENCRYPTION KEY: every call below that touches an EmployeeProfile's
 * sensitive fields (create, decrypt-read, or the bulk payment file
 * export, which decrypts bank account numbers) takes an explicit
 * `encryptionKey` string. This transport NEVER generates, stores, or
 * hardcodes that key — it is a deployment-time secret the app must be
 * configured with (see the migration's own header note 1). Never log
 * it, never send it anywhere other than these RPC calls.
 *
 * PCB NOTE: `computeStatutoryDeductions`'s `pcbDeduction` is a
 * SIMPLIFIED progressive-bracket approximation of LHDN's real PCB
 * Schedule/Formula Method — see MY-PCB-2026.json's own `source_note`.
 * Do not present it to a user as a real, filing-ready PCB figure
 * without that caveat.
 *
 * BULK PAYMENT FILE NOTE: `generateBulkPaymentFileExport`'s CSV layout
 * is a documented-generic Malaysian bulk-pay layout, NOT verified
 * against Maybank2u's real portal template — see the migration's own
 * owner-decision header. Do not present a generated file as
 * bank-ready without the owner (or their bank) confirming it uploads
 * successfully first.
 * ============================================================
 */

/** See supabaseTransport.ts's own header comment for why this exists instead of importing `SupabaseClient` from `@supabase/supabase-js` directly. */
export interface SupabaseClientLike {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type EmploymentType = "full_time" | "part_time" | "contract";

/** Row shape of public.employee_profiles (encrypted columns omitted — never read directly; use getEmployeeProfileDecrypted). */
export interface EmployeeProfileRow {
  id: string;
  business_id: string;
  party_id: string;
  bank_name: string | null;
  basic_salary: number;
  employment_type: EmploymentType;
  hire_date: string;
  resign_date: string | null;
  created_by_membership_id: string | null;
  created_at: string;
}

export interface EmployeeProfile {
  id: string;
  businessId: string;
  partyId: string;
  bankName: string | null;
  basicSalary: number;
  employmentType: EmploymentType;
  hireDate: string;
  resignDate: string | null;
  createdByMembershipId: string | null;
  createdAt: string;
}

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

/** Row shape of get_employee_profile_decrypted's result — the ONLY place plaintext sensitive fields ever appear client-side. */
export interface EmployeeProfileDecryptedRow {
  id: string;
  party_id: string;
  ic_number: string;
  epf_number: string | null;
  socso_number: string | null;
  income_tax_no: string | null;
  bank_name: string | null;
  bank_account_no: string;
  basic_salary: number;
  employment_type: EmploymentType;
  hire_date: string;
  resign_date: string | null;
}

export interface EmployeeProfileDecrypted {
  id: string;
  partyId: string;
  icNumber: string;
  epfNumber: string | null;
  socsoNumber: string | null;
  incomeTaxNo: string | null;
  bankName: string | null;
  bankAccountNo: string;
  basicSalary: number;
  employmentType: EmploymentType;
  hireDate: string;
  resignDate: string | null;
}

function toEmployeeProfileDecrypted(row: EmployeeProfileDecryptedRow): EmployeeProfileDecrypted {
  return {
    id: row.id,
    partyId: row.party_id,
    icNumber: row.ic_number,
    epfNumber: row.epf_number,
    socsoNumber: row.socso_number,
    incomeTaxNo: row.income_tax_no,
    bankName: row.bank_name,
    bankAccountNo: row.bank_account_no,
    basicSalary: row.basic_salary,
    employmentType: row.employment_type,
    hireDate: row.hire_date,
    resignDate: row.resign_date,
  };
}

/** Row shape of public.compute_statutory_deductions's (single-row) result. */
export interface StatutoryDeductionsRow {
  epf_employee: number;
  epf_employer: number;
  socso_employee: number;
  socso_employer: number;
  eis_employee: number;
  eis_employer: number;
  pcb_deduction: number;
}

export interface StatutoryDeductions {
  epfEmployee: number;
  epfEmployer: number;
  socsoEmployee: number;
  socsoEmployer: number;
  eisEmployee: number;
  eisEmployer: number;
  /** SIMPLIFIED approximation — see this file's own header note. */
  pcbDeduction: number;
}

function toStatutoryDeductions(row: StatutoryDeductionsRow): StatutoryDeductions {
  return {
    epfEmployee: row.epf_employee,
    epfEmployer: row.epf_employer,
    socsoEmployee: row.socso_employee,
    socsoEmployer: row.socso_employer,
    eisEmployee: row.eis_employee,
    eisEmployer: row.eis_employer,
    pcbDeduction: row.pcb_deduction,
  };
}

export type PayrollRunStatus = "draft" | "pending_approval" | "approved" | "paid";

/** Row shape of public.payroll_runs. */
export interface PayrollRunRow {
  id: string;
  business_id: string;
  period: string;
  status: PayrollRunStatus;
  total_net_pay: number;
  created_by_membership_id: string | null;
  created_at: string;
}

export interface PayrollRun {
  id: string;
  businessId: string;
  period: string;
  status: PayrollRunStatus;
  totalNetPay: number;
  createdByMembershipId: string | null;
  createdAt: string;
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

export type EPayslipChannel = "whatsapp" | "email";

/** Row shape of public.payslips. */
export interface PayslipRow {
  id: string;
  payroll_run_id: string;
  employee_party_id: string;
  gross_pay: number;
  epf_employee: number;
  epf_employer: number;
  socso_employee: number;
  socso_employer: number;
  eis_employee: number;
  eis_employer: number;
  pcb_deduction: number;
  claims_included: number;
  advance_deducted: number;
  net_pay: number;
  e_payslip_sent_at: string | null;
  e_payslip_channel: EPayslipChannel | null;
  created_at: string;
}

export interface Payslip {
  id: string;
  payrollRunId: string;
  employeePartyId: string;
  grossPay: number;
  epfEmployee: number;
  epfEmployer: number;
  socsoEmployee: number;
  socsoEmployer: number;
  eisEmployee: number;
  eisEmployer: number;
  pcbDeduction: number;
  claimsIncluded: number;
  advanceDeducted: number;
  netPay: number;
  ePayslipSentAt: string | null;
  ePayslipChannel: EPayslipChannel | null;
  createdAt: string;
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

export type ClaimStatus = "pending_approval" | "approved" | "included_in_payroll" | "rejected";

/** Row shape of public.claims. */
export interface ClaimRow {
  id: string;
  business_id: string;
  employee_party_id: string;
  amount: number;
  category: string;
  status: ClaimStatus;
  document_id_receipt: string | null;
  created_by_membership_id: string | null;
  created_at: string;
}

export interface Claim {
  id: string;
  businessId: string;
  employeePartyId: string;
  amount: number;
  category: string;
  status: ClaimStatus;
  documentIdReceipt: string | null;
  createdByMembershipId: string | null;
  createdAt: string;
}

function toClaim(row: ClaimRow): Claim {
  return {
    id: row.id,
    businessId: row.business_id,
    employeePartyId: row.employee_party_id,
    amount: row.amount,
    category: row.category,
    status: row.status,
    documentIdReceipt: row.document_id_receipt,
    createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at,
  };
}

export type SalaryAdvanceStatus = "pending_approval" | "approved" | "fully_deducted" | "rejected";

/** Row shape of public.salary_advances. */
export interface SalaryAdvanceRow {
  id: string;
  business_id: string;
  employee_party_id: string;
  amount: number;
  status: SalaryAdvanceStatus;
  outstanding_balance: number;
  created_by_membership_id: string | null;
  created_at: string;
}

export interface SalaryAdvance {
  id: string;
  businessId: string;
  employeePartyId: string;
  amount: number;
  status: SalaryAdvanceStatus;
  outstandingBalance: number;
  createdByMembershipId: string | null;
  createdAt: string;
}

function toSalaryAdvance(row: SalaryAdvanceRow): SalaryAdvance {
  return {
    id: row.id,
    businessId: row.business_id,
    employeePartyId: row.employee_party_id,
    amount: row.amount,
    status: row.status,
    outstandingBalance: row.outstanding_balance,
    createdByMembershipId: row.created_by_membership_id,
    createdAt: row.created_at,
  };
}

/** Row shape of public.bulk_payment_file_exports. */
export interface BulkPaymentFileExportRow {
  id: string;
  payroll_run_id: string;
  bank_format: string;
  file_ref: string;
  file_content: string;
  created_by_membership_id: string | null;
  created_at: string;
}

export interface BulkPaymentFileExport {
  id: string;
  payrollRunId: string;
  bankFormat: string;
  fileRef: string;
  /** The actual generated CSV text — see this file's own header note on why this is NOT bank-verified yet. */
  fileContent: string;
  createdByMembershipId: string | null;
  createdAt: string;
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

export interface SupabasePayrollTransport {
  /** `capture` on `payroll`. Creates an EmployeeProfile for an existing `employee`-typed Party, encrypting the sensitive fields with `encryptionKey` server-side. */
  createEmployeeProfile(params: {
    businessId: string;
    partyId: string;
    icNumber: string;
    epfNumber?: string | null;
    socsoNumber?: string | null;
    incomeTaxNo?: string | null;
    bankName?: string | null;
    bankAccountNo: string;
    basicSalary: number;
    employmentType: EmploymentType;
    hireDate: string;
    encryptionKey: string;
  }): Promise<EmployeeProfile>;

  /** `view` on `payroll`. Decrypts an EmployeeProfile's sensitive fields with `encryptionKey` — the only place plaintext IC/EPF/SOCSO/income-tax/bank-account numbers ever reach the client. Throws (not silently garbage) if `encryptionKey` is wrong. */
  getEmployeeProfileDecrypted(employeeProfileId: string, encryptionKey: string): Promise<EmployeeProfileDecrypted>;

  /** No auth gate — a deterministic lookup+arithmetic function, same posture as `resolve_price` (Sprint 27). See this file's own PCB caveat. */
  computeStatutoryDeductions(grossPay: number, asOf?: string): Promise<StatutoryDeductions>;

  /** `capture` on `payroll`. Drafts a PayrollRun and one Payslip per active EmployeeProfile for the period, sweeping in any `approved` Claims/SalaryAdvances for each employee. */
  createPayrollRun(params: { businessId: string; period: string }): Promise<PayrollRun>;

  /**
   * `capture` on `payroll`. Moves 'draft' -> 'pending_approval' and
   * opens the ApprovalTask. THIS NEVER TAKES THE AUTO-APPROVE PATH —
   * there is no parameter here or server-side to force it (Vol 13_0
   * §10's hard rule; see the migration's own header note 7). Do not
   * add one.
   */
  submitPayrollRun(payrollRunId: string): Promise<PayrollRun>;

  /** `capture` on `payroll`. Marks a Payslip as delivered via the given channel, recording the timestamp. Throws if already sent, or if the PayrollRun isn't yet 'approved'/'paid'. */
  markPayslipSent(payslipId: string, channel: EPayslipChannel): Promise<Payslip>;

  /** `capture` on `payroll`. Builds the bulk payment CSV for an 'approved' PayrollRun, decrypting each employee's bank account number with `encryptionKey`. Throws if already generated for this run. See this file's own bank-format caveat. */
  generateBulkPaymentFileExport(params: {
    payrollRunId: string;
    encryptionKey: string;
    bankFormat?: string;
  }): Promise<BulkPaymentFileExport>;

  /** `capture` on `payroll`, or `configure` on `accounting_reports`. The actual cash-movement moment — posts Salaries & Wages / Statutory Contributions Payable / Cash ledger entries and moves the run to 'paid'. Throws unless a bulk payment file has already been generated. */
  markPayrollRunPaid(payrollRunId: string): Promise<PayrollRun>;

  /** `capture` on `payroll`. Raises a Claim for an employee, opening its own ApprovalTask before it can be swept into a run. */
  createClaim(params: {
    businessId: string;
    employeePartyId: string;
    amount: number;
    category: string;
    documentIdReceipt?: string | null;
  }): Promise<Claim>;

  /** `capture` on `payroll`. Raises a SalaryAdvance for an employee, opening its own ApprovalTask. The full amount is deducted in a single future payroll run — see this file's own header note on instalments not being modelled this sprint. */
  createSalaryAdvance(params: { businessId: string; employeePartyId: string; amount: number }): Promise<SalaryAdvance>;
}

export function createSupabasePayrollTransport(client: SupabaseClientLike): SupabasePayrollTransport {
  return {
    async createEmployeeProfile(params) {
      const { data, error } = await client.rpc("create_employee_profile", {
        p_business_id: params.businessId,
        p_party_id: params.partyId,
        p_ic_number: params.icNumber,
        p_epf_number: params.epfNumber ?? null,
        p_socso_number: params.socsoNumber ?? null,
        p_income_tax_no: params.incomeTaxNo ?? null,
        p_bank_name: params.bankName ?? null,
        p_bank_account_no: params.bankAccountNo,
        p_basic_salary: params.basicSalary,
        p_employment_type: params.employmentType,
        p_hire_date: params.hireDate,
        p_encryption_key: params.encryptionKey,
      });
      if (error) throw error;
      const rows = data as EmployeeProfileRow[];
      return toEmployeeProfile(rows[0]);
    },

    async getEmployeeProfileDecrypted(employeeProfileId, encryptionKey) {
      const { data, error } = await client.rpc("get_employee_profile_decrypted", {
        p_employee_profile_id: employeeProfileId,
        p_encryption_key: encryptionKey,
      });
      if (error) throw error;
      const rows = data as EmployeeProfileDecryptedRow[];
      return toEmployeeProfileDecrypted(rows[0]);
    },

    async computeStatutoryDeductions(grossPay, asOf) {
      const { data, error } = await client.rpc("compute_statutory_deductions", {
        p_gross_pay: grossPay,
        p_as_of: asOf ?? null,
      });
      if (error) throw error;
      const rows = data as StatutoryDeductionsRow[];
      return toStatutoryDeductions(rows[0]);
    },

    async createPayrollRun(params) {
      const { data, error } = await client.rpc("create_payroll_run", {
        p_business_id: params.businessId,
        p_period: params.period,
      });
      if (error) throw error;
      const rows = data as PayrollRunRow[];
      return toPayrollRun(rows[0]);
    },

    async submitPayrollRun(payrollRunId) {
      const { data, error } = await client.rpc("submit_payroll_run", {
        p_payroll_run_id: payrollRunId,
      });
      if (error) throw error;
      const rows = data as PayrollRunRow[];
      return toPayrollRun(rows[0]);
    },

    async markPayslipSent(payslipId, channel) {
      const { data, error } = await client.rpc("mark_payslip_sent", {
        p_payslip_id: payslipId,
        p_channel: channel,
      });
      if (error) throw error;
      const rows = data as PayslipRow[];
      return toPayslip(rows[0]);
    },

    async generateBulkPaymentFileExport(params) {
      const { data, error } = await client.rpc("generate_bulk_payment_file_export", {
        p_payroll_run_id: params.payrollRunId,
        p_encryption_key: params.encryptionKey,
        p_bank_format: params.bankFormat ?? "Maybank2u",
      });
      if (error) throw error;
      const rows = data as BulkPaymentFileExportRow[];
      return toBulkPaymentFileExport(rows[0]);
    },

    async markPayrollRunPaid(payrollRunId) {
      const { data, error } = await client.rpc("mark_payroll_run_paid", {
        p_payroll_run_id: payrollRunId,
      });
      if (error) throw error;
      const rows = data as PayrollRunRow[];
      return toPayrollRun(rows[0]);
    },

    async createClaim(params) {
      const { data, error } = await client.rpc("create_claim", {
        p_business_id: params.businessId,
        p_employee_party_id: params.employeePartyId,
        p_amount: params.amount,
        p_category: params.category,
        p_document_id_receipt: params.documentIdReceipt ?? null,
      });
      if (error) throw error;
      const rows = data as ClaimRow[];
      return toClaim(rows[0]);
    },

    async createSalaryAdvance(params) {
      const { data, error } = await client.rpc("create_salary_advance", {
        p_business_id: params.businessId,
        p_employee_party_id: params.employeePartyId,
        p_amount: params.amount,
      });
      if (error) throw error;
      const rows = data as SalaryAdvanceRow[];
      return toSalaryAdvance(rows[0]);
    },
  };
}
