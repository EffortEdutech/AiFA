/**
 * DEV-ONLY sample data for seed mode (see seedClient.ts). Fictional
 * business "Kedai Contoh Sdn Bhd"; every name, number and amount below is
 * invented. Columns follow the migrations' snake_case table shapes so the
 * existing mappers in web/src/lib and packages/core run unchanged.
 */
type Row = Record<string, unknown>;

const DAY = 86_400_000;
const now = Date.now();
const iso = (offsetDays: number): string => new Date(now + offsetDays * DAY).toISOString();
const day = (offsetDays: number): string => iso(offsetDays).slice(0, 10);

const id = (kind: number, n: number): string =>
  `00000000-0000-4000-8000-${String(kind).padStart(4, "0")}${String(n).padStart(8, "0")}`;

export const SEED_BUSINESS_ID = id(1, 1);
export const SEED_USER_ID = "00000000-dev0-0000-0000-000000000001";
const OWNER_ROLE = "00000000-0000-0000-0000-000000000001";
const STAFF_ROLE = id(2, 2);
const ME = id(3, 1);

const party = (n: number, name: string, types: string[], extra: Row = {}): Row => ({
  id: id(10, n), business_id: SEED_BUSINESS_ID, party_no: `P-${String(n).padStart(4, "0")}`,
  display_name: name, legal_name: `${name} Sdn Bhd`, party_types: types, registration_no: `2020${n}0123456`,
  tin: `C${20000000 + n}`, sst_reg_no: null, contact_phone: `+6012-345 ${1000 + n}`,
  contact_email: `hello@${name.toLowerCase().replace(/\W+/g, "")}.example`, billing_address: `${n}, Jalan Contoh, 50000 Kuala Lumpur`,
  price_type_id: id(11, 1), credit_limit: 20000, credit_terms_days: 30, status: "active",
  created_by_membership_id: ME, created_at: iso(-120), ...extra,
});

const parties: Row[] = [
  party(1, "Maju Jaya Trading", ["customer"]),
  party(2, "Bunga Raya Catering", ["customer"]),
  party(3, "Sinar Teknik", ["customer", "supplier"]),
  party(4, "Harmoni Packaging", ["supplier"]),
  party(5, "Pasar Segar Wholesale", ["supplier"]),
  party(6, "Aisyah binti Rahman", ["employee"]),
  party(7, "Tan Wei Ming", ["employee"]),
  party(8, "Kumar a/l Subramaniam", ["employee"]),
];

const products: Row[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: id(20, n), business_id: SEED_BUSINESS_ID, sku: `SKU-${100 + n}`,
  name: ["Nasi Lemak Pack", "Teh Tarik Sachet (box)", "Paper Bag Large", "Cleaning Service (hour)", "Thermal Roll 80mm", "Gift Hamper"][n - 1],
  unit_of_measure: n === 4 ? "hour" : "unit", default_cost: [3.2, 18, 0.9, 25, 2.4, 45][n - 1],
  cost_source: "manual", track_inventory: n !== 4, status: "active", created_by_membership_id: ME, created_at: iso(-100),
}));

const priceTypes: Row[] = [
  { id: id(11, 1), business_id: SEED_BUSINESS_ID, name: "Retail", is_default: true, created_at: iso(-100) },
  { id: id(11, 2), business_id: SEED_BUSINESS_ID, name: "Wholesale", is_default: false, created_at: iso(-100) },
];
const priceListEntries: Row[] = products.slice(0, 4).map((p, i) => ({
  id: id(12, i + 1), business_id: SEED_BUSINESS_ID, product_id: p.id, price_type_id: id(11, 1),
  unit_price: [6.5, 28, 1.8, 60][i], effective_from: day(-90), created_at: iso(-90),
}));

const warehouses: Row[] = [
  { id: id(21, 1), business_id: SEED_BUSINESS_ID, name: "Main Store", created_at: iso(-100) },
  { id: id(21, 2), business_id: SEED_BUSINESS_ID, name: "Kitchen", created_at: iso(-100) },
];
const stockLevels: Row[] = products.filter((p) => p.track_inventory).map((p, i) => ({
  business_id: SEED_BUSINESS_ID, product_id: p.id, warehouse_id: id(21, 1),
  quantity_on_hand: [120, 40, 500, 18, 6][i], last_movement_at: iso(-3),
}));

const invoiceDefs: Array<[number, number, string, number, number, number]> = [
  // n, party, status, issueOffset, dueOffset, total
  [1, 1, "paid", -40, -10, 1250], [2, 2, "partially_paid", -30, 0, 3180], [3, 3, "issued", -20, 10, 860],
  [4, 1, "overdue", -75, -45, 2400], [5, 2, "draft", -2, 28, 540], [6, 3, "sent", -8, 22, 1975],
];
const invoices: Row[] = invoiceDefs.map(([n, p, status, io, dd, total]) => ({
  id: id(30, n), business_id: SEED_BUSINESS_ID, invoice_no: `INV-2026-${String(n).padStart(4, "0")}`, party_id: id(10, p),
  status, issue_date: day(io), due_date: day(dd), currency: "MYR", subtotal: total, tax_total: 0, grand_total: total,
  notes: null, source_quotation_id: null, delivery_order_id: null, e_invoice_status: n === 1 ? "valid" : "not_submitted",
  outstanding_balance: status === "paid" ? 0 : status === "partially_paid" ? total - 1000 : status === "draft" ? total : total,
  captured_by_membership_id: ME, created_at: iso(io), agent_party_id: null,
}));
const invoiceLines: Row[] = invoices.map((inv, i) => ({
  id: id(31, i + 1), invoice_id: inv.id, line_no: 1, product_id: id(20, (i % 4) + 1), description: `Goods and services for ${inv.invoice_no}`,
  quantity: 10, unit_price: Number(inv.grand_total) / 10, unit_cost: 0, tax_code: null, discount_amount: 0, line_total: inv.grand_total,
}));

const quotationDefs: Array<[number, number, string, number]> = [
  [1, 1, "draft", 1800], [2, 2, "sent", 4200], [3, 3, "accepted", 960], [4, 1, "converted", 1250],
];
const quotations: Row[] = quotationDefs.map(([n, p, status, total]) => ({
  id: id(32, n), business_id: SEED_BUSINESS_ID, quotation_no: `QT-2026-${String(n).padStart(4, "0")}`, party_id: id(10, p), status,
  issue_date: day(-14 - n), valid_until: day(16 - n), currency: "MYR", subtotal: total, tax_total: 0, grand_total: total, notes: null,
  converted_invoice_id: status === "converted" ? id(30, 1) : null, captured_by_membership_id: ME, created_at: iso(-14 - n),
}));
const quotationLines: Row[] = quotations.map((q, i) => ({
  id: id(33, i + 1), quotation_id: q.id, line_no: 1, product_id: id(20, (i % 4) + 1), description: "Quoted item",
  quantity: 5, unit_price: Number(q.grand_total) / 5, unit_cost: 0, tax_code: null, discount_amount: 0, line_total: q.grand_total,
}));

const payments: Row[] = [
  { id: id(34, 1), business_id: SEED_BUSINESS_ID, invoice_id: id(30, 1), amount: 1250, method: "bank_transfer", received_at: day(-12), reference: "FPX-88231", recorded_by_membership_id: ME, created_at: iso(-12) },
  { id: id(34, 2), business_id: SEED_BUSINESS_ID, invoice_id: id(30, 2), amount: 1000, method: "cash", received_at: day(-9), reference: null, recorded_by_membership_id: ME, created_at: iso(-9) },
];
const creditNotes: Row[] = [
  { id: id(35, 1), business_id: SEED_BUSINESS_ID, credit_note_no: "CN-2026-0001", party_id: id(10, 1), source_invoice_id: id(30, 4), status: "issued", issue_date: day(-20), currency: "MYR", grand_total: 200, reason: "Damaged goods returned", captured_by_membership_id: ME, created_at: iso(-20) },
];

const coa: Row[] = [
  ["1000", "Cash and Bank", "asset"], ["1100", "Accounts Receivable", "asset"], ["1200", "Inventory", "asset"],
  ["2000", "Accounts Payable", "liability"], ["3000", "Owner's Equity", "equity"],
  ["4000", "Sales Revenue", "revenue"], ["5000", "Cost of Goods Sold", "expense"], ["6100", "Rent", "expense"], ["6200", "Utilities", "expense"],
].map(([code, name, type], i) => ({
  id: id(40, i + 1), business_id: SEED_BUSINESS_ID, account_code: code, account_name: name, account_type: type,
  parent_account_id: null, is_system: true, created_at: iso(-100),
}));
const bankAccounts: Row[] = [
  { id: id(41, 1), business_id: SEED_BUSINESS_ID, account_name: "Maybank Current (sample)", ledger_account_id: id(40, 1), opening_balance: 5000, created_at: iso(-100) },
];
const bankStatementLines: Row[] = [
  { id: id(42, 1), bank_account_id: id(41, 1), statement_date: day(-12), description: "FPX-88231 Maju Jaya", amount: 1250, direction: "credit", matched_entry_id: null, created_at: iso(-12) },
  { id: id(42, 2), bank_account_id: id(41, 1), statement_date: day(-6), description: "TNB bill", amount: 310, direction: "debit", matched_entry_id: null, created_at: iso(-6) },
];

const paymentVouchers: Row[] = [
  { id: id(50, 1), business_id: SEED_BUSINESS_ID, pv_no: "PV-2026-0001", payee_party_id: id(10, 4), status: "paid", expense_category: "6100", document_id_receipt: null, payment_method: "bank_transfer", issue_date: day(-15), currency: "MYR", grand_total: 1800, notes: "Monthly rent", captured_by_membership_id: ME, created_at: iso(-15), sst_code: null },
  { id: id(50, 2), business_id: SEED_BUSINESS_ID, pv_no: "PV-2026-0002", payee_party_id: id(10, 5), status: "draft", expense_category: "5000", document_id_receipt: null, payment_method: "cash", issue_date: day(-3), currency: "MYR", grand_total: 640, notes: null, captured_by_membership_id: ME, created_at: iso(-3), sst_code: null },
];
const purchaseOrders: Row[] = [
  { id: id(51, 1), business_id: SEED_BUSINESS_ID, po_no: "PO-2026-0001", party_id: id(10, 4), status: "issued", issue_date: day(-10), expected_delivery_date: day(4), currency: "MYR", subtotal: 900, tax_total: 0, grand_total: 900, notes: null, captured_by_membership_id: ME, created_at: iso(-10) },
  { id: id(51, 2), business_id: SEED_BUSINESS_ID, po_no: "PO-2026-0002", party_id: id(10, 5), status: "draft", issue_date: day(-1), expected_delivery_date: day(7), currency: "MYR", subtotal: 450, tax_total: 0, grand_total: 450, notes: null, captured_by_membership_id: ME, created_at: iso(-1) },
];
const deliveryOrders: Row[] = [
  { id: id(52, 1), business_id: SEED_BUSINESS_ID, do_no: "DO-2026-0001", invoice_id: id(30, 2), warehouse_id: id(21, 1), status: "delivered", issue_date: day(-28), notes: null, captured_by_membership_id: ME, created_at: iso(-28) },
  { id: id(52, 2), business_id: SEED_BUSINESS_ID, do_no: "DO-2026-0002", invoice_id: id(30, 3), warehouse_id: id(21, 1), status: "draft", issue_date: day(-2), notes: null, captured_by_membership_id: ME, created_at: iso(-2) },
];
const deliveryOrderLines: Row[] = [
  { id: id(53, 1), delivery_order_id: id(52, 1), line_no: 1, product_id: id(20, 1), description: "Nasi Lemak Pack", quantity: 20 },
  { id: id(53, 2), delivery_order_id: id(52, 2), line_no: 1, product_id: id(20, 2), description: "Teh Tarik Sachet (box)", quantity: 6 },
];

const contracts: Row[] = [
  { id: id(60, 1), business_id: SEED_BUSINESS_ID, counterparty_id: id(10, 4), contract_type: "supply_agreement", status: "active", start_date: day(-300), end_date: day(45), auto_renew: false, renewal_notice_days: 60, document_id: null, credit_limit_override: null, created_by_membership_id: ME, created_at: iso(-300) },
  { id: id(60, 2), business_id: SEED_BUSINESS_ID, counterparty_id: id(10, 1), contract_type: "service_agreement", status: "draft", start_date: day(10), end_date: day(375), auto_renew: true, renewal_notice_days: 30, document_id: null, credit_limit_override: 30000, created_by_membership_id: ME, created_at: iso(-5) },
];
const eSignatureEnvelopes: Row[] = [
  { id: id(61, 1), business_id: SEED_BUSINESS_ID, contract_id: id(60, 1), quotation_id: null, provider: "simulated", status: "sent", signed_document_id: null, created_by_membership_id: ME, created_at: iso(-4) },
];

const payrollRuns: Row[] = [
  { id: id(70, 1), business_id: SEED_BUSINESS_ID, period: "2026-08", status: "approved", total_net_pay: 8120, created_by_membership_id: ME, created_at: iso(-35) },
  { id: id(70, 2), business_id: SEED_BUSINESS_ID, period: "2026-09", status: "draft", total_net_pay: 8120, created_by_membership_id: ME, created_at: iso(-5) },
];
const payslips: Row[] = [6, 7, 8].flatMap((p, i) => [1, 2].map((r) => ({
  id: id(71, i * 2 + r), payroll_run_id: id(70, r), employee_party_id: id(10, p), gross_pay: 3000 + i * 400,
  epf_employee: 330 + i * 44, epf_employer: 390 + i * 52, socso_employee: 14.75, socso_employer: 51.65, eis_employee: 5.9, eis_employer: 5.9,
  pcb_deduction: 60 + i * 30, claims_included: 0, advance_deducted: 0, net_pay: 2600 + i * 330, e_payslip_sent_at: null, e_payslip_channel: null, created_at: iso(-5),
})));
const employeeProfiles: Row[] = [6, 7, 8].map((p, i) => ({
  id: id(72, i + 1), business_id: SEED_BUSINESS_ID, party_id: id(10, p), bank_name: "Maybank", basic_salary: 3000 + i * 400,
  employment_type: i === 2 ? "contract" : "permanent", hire_date: day(-400 + i * 30), resign_date: null, created_by_membership_id: ME, created_at: iso(-400),
}));
const leaveTypes: Row[] = [
  { id: id(73, 1), business_id: SEED_BUSINESS_ID, name: "Annual Leave", days_per_year: 12, created_at: iso(-100) },
  { id: id(73, 2), business_id: SEED_BUSINESS_ID, name: "Medical Leave", days_per_year: 14, created_at: iso(-100) },
];
const leaveApplications: Row[] = [
  { id: id(74, 1), business_id: SEED_BUSINESS_ID, employee_party_id: id(10, 6), leave_type_id: id(73, 1), start_date: day(7), end_date: day(9), days: 3, status: "pending", created_at: iso(-1) },
];

const roles: Row[] = [
  { id: OWNER_ROLE, business_id: null, name: "Owner", is_system_template: true, description: "Full access", default_approval_limit_myr: null, created_at: iso(-200) },
  { id: STAFF_ROLE, business_id: null, name: "Staff", is_system_template: true, description: "Day-to-day entry", default_approval_limit_myr: 500, created_at: iso(-200) },
];
const memberships: Row[] = [
  { id: ME, business_id: SEED_BUSINESS_ID, user_id: SEED_USER_ID, role_id: OWNER_ROLE, party_id: null, approval_limit_myr: null, status: "active", invited_by_membership_id: null, invited_at: iso(-200), accepted_at: iso(-200), removed_at: null, invited_email: null, owner_label: "Owner" },
  { id: id(3, 2), business_id: SEED_BUSINESS_ID, user_id: id(4, 2), role_id: STAFF_ROLE, party_id: id(10, 6), approval_limit_myr: 500, status: "active", invited_by_membership_id: ME, invited_at: iso(-60), accepted_at: iso(-58), removed_at: null, invited_email: "aisyah@example.test", owner_label: null },
  { id: id(3, 3), business_id: SEED_BUSINESS_ID, user_id: id(4, 3), role_id: STAFF_ROLE, party_id: null, approval_limit_myr: 500, status: "invited", invited_by_membership_id: ME, invited_at: iso(-2), accepted_at: null, removed_at: null, invited_email: "wei.ming@example.test", owner_label: null },
];
const devices: Row[] = [
  { device_id: "seed-device-web", business_id: SEED_BUSINESS_ID, device_label: "Owner laptop (this browser)", platform: "web", registered_at: iso(-90), last_seen_at: iso(0), last_synced_server_seq: 120, is_primary: true, revoked_at: null, business_membership_id: ME },
  { device_id: "seed-device-phone", business_id: SEED_BUSINESS_ID, device_label: "Owner phone", platform: "android", registered_at: iso(-80), last_seen_at: iso(-1), last_synced_server_seq: 118, is_primary: false, revoked_at: null, business_membership_id: ME },
];
const approvalTasks: Row[] = [
  { id: id(80, 1), business_id: SEED_BUSINESS_ID, domain: "purchases_cash", subject_type: "payment_voucher", subject_id: id(50, 2), amount: 640, ai_draft_summary: "Supplier invoice from Pasar Segar Wholesale", ai_confidence: 0.91, captured_by_membership_id: id(3, 2), assigned_membership_id: ME, resolved_via: "manual", delegated_from_membership_id: null, status: "pending", decided_by_membership_id: null, decided_at: null, next_action: null, self_approved_via_escape_valve: false, created_at: iso(-3), on_approval_action: null },
];
const captureTriage: Row[] = [
  { id: id(81, 1), business_id: SEED_BUSINESS_ID, raw_text: "Bayar sewa kedai RM1800 kepada Harmoni Packaging", detected_domain: "purchases_cash", status: "pending", created_by_membership_id: ME, created_at: iso(-1) },
];
const eInvoiceSubmissions: Row[] = [
  { id: id(82, 1), business_id: SEED_BUSINESS_ID, invoice_id: id(30, 1), lhdn_uuid: "SIM-0000-AAAA", qr_code_ref: null, submission_type: "invoice", consolidated_period: null, status: "valid", irb_response_ref: "SIMULATED", submitted_at: iso(-39), created_by_membership_id: ME, created_at: iso(-39) },
];
const sstRates: Row[] = [
  { sst_code: "SST-SVC-8", tax_type: "service_tax", rate: 0.08, description: "Service tax 8% (sample)", rule_version: "2026-sample" },
  { sst_code: "SST-SALES-10", tax_type: "sales_tax", rate: 0.1, description: "Sales tax 10% (sample)", rule_version: "2026-sample" },
];
const businesses: Row[] = [
  { id: SEED_BUSINESS_ID, owner_user_id: SEED_USER_ID, legal_name: "Kedai Contoh Sdn Bhd", industry: "retail", pka_version: "1", created_at: iso(-200), access_model_override: null, commission_trigger_status: "paid", ssm_registration_number: "202001000001 (sample)", slug: "kedai-contoh" },
];
const publicSiteContent: Row[] = [
  { business_id: SEED_BUSINESS_ID, hero_headline: "Fresh food, fair prices", hero_subtext: "Sample copy for the seeded business.", services: [{ name: "Catering", description: "Event and office catering." }, { name: "Wholesale", description: "Bulk supply for cafes." }], contact_email: "hello@kedai-contoh.example", contact_phone: "+60 12-345 6789", accent_color: "#2f6f5e", published_at: iso(-10), updated_at: iso(-10) },
];

export const SEED_TABLES: Record<string, Row[]> = {
  businesses, roles, business_memberships: memberships, devices, parties, products, price_types: priceTypes,
  price_list_entries: priceListEntries, warehouses, stock_levels: stockLevels, invoices, invoice_lines: invoiceLines,
  quotations, quotation_lines: quotationLines, payments, credit_notes: creditNotes, chart_of_accounts: coa,
  bank_accounts: bankAccounts, bank_statement_lines: bankStatementLines, payment_vouchers: paymentVouchers,
  purchase_order: purchaseOrders, delivery_orders: deliveryOrders, delivery_order_lines: deliveryOrderLines,
  contracts, e_signature_envelopes: eSignatureEnvelopes, payroll_runs: payrollRuns, payslips,
  employee_profiles: employeeProfiles, leave_types: leaveTypes, leave_applications: leaveApplications,
  approval_tasks: approvalTasks, capture_triage: captureTriage, e_invoice_submissions: eInvoiceSubmissions,
  sst_rates: sstRates, public_site_content: publicSiteContent,
};

const ageing = (inv: Row, daysOverdue: number): Row => ({
  invoice_id: inv.id, invoice_no: inv.invoice_no, party_id: inv.party_id, due_date: inv.due_date,
  outstanding_balance: inv.outstanding_balance, days_overdue: daysOverdue,
  ageing_bucket: daysOverdue <= 0 ? "current" : daysOverdue <= 30 ? "1_30" : daysOverdue <= 60 ? "31_60" : "61_plus",
});

/** Read-only RPC results, keyed by function name. */
export const SEED_RPC: Record<string, unknown | ((args: Record<string, unknown>) => unknown)> = {
  list_my_businesses: [{ business_id: SEED_BUSINESS_ID, legal_name: "Kedai Contoh Sdn Bhd", role_id: OWNER_ROLE, membership_status: "active" }],
  effective_access_model: "team",
  list_member_identities: [{ membership_id: ME, display_name: "Eff (Owner)" }, { membership_id: id(3, 2), display_name: "Aisyah Rahman" }],
  ar_ageing_detail: [ageing(invoices[1], 0), ageing(invoices[2], -10), ageing(invoices[3], 45), ageing(invoices[5], -22)],
  cash_book_detail: [
    { entry_id: id(90, 1), posted_at: iso(-12), direction: "debit", amount: 1250, running_balance: 6250 },
    { entry_id: id(90, 2), posted_at: iso(-9), direction: "debit", amount: 1000, running_balance: 7250 },
    { entry_id: id(90, 3), posted_at: iso(-6), direction: "credit", amount: 310, running_balance: 6940 },
  ],
  general_ledger_detail: [
    { entry_id: id(91, 1), posted_at: iso(-20), direction: "debit", amount: 860, running_balance: 860 },
    { entry_id: id(91, 2), posted_at: iso(-12), direction: "credit", amount: 400, running_balance: 460 },
  ],
  profit_and_loss_summary: [{ total_revenue: 10205, total_expense: 4310, net_profit: 5895 }],
  expense_category_breakdown: [
    { account_code: "6100", account_name: "Rent", amount: 1800, pct_of_total_expense: 41.8 },
    { account_code: "5000", account_name: "Cost of Goods Sold", amount: 2200, pct_of_total_expense: 51.0 },
    { account_code: "6200", account_name: "Utilities", amount: 310, pct_of_total_expense: 7.2 },
  ],
  trial_balance: [
    { account_code: "1000", account_name: "Cash and Bank", account_type: "asset", total_debit: 7250, total_credit: 310, balance: 6940 },
    { account_code: "1100", account_name: "Accounts Receivable", account_type: "asset", total_debit: 10205, total_credit: 2250, balance: 7955 },
    { account_code: "4000", account_name: "Sales Revenue", account_type: "revenue", total_debit: 0, total_credit: 10205, balance: -10205 },
    { account_code: "6100", account_name: "Rent", account_type: "expense", total_debit: 1800, total_credit: 0, balance: 1800 },
  ],
  balance_sheet_summary: [{ total_assets: 14895, total_liabilities: 2100, total_equity: 12795 }],
  tax_report_placeholder: [{ date_from: day(-30), date_to: day(0), output_tax_sst: null, input_tax_sst: null, note: "Placeholder: SST figures are not computed in this build." }],
  stock_report: products.filter((p) => p.track_inventory).map((p, i) => ({
    product_id: p.id, sku: p.sku, product_name: p.name, warehouse_id: id(21, 1), quantity_on_hand: [120, 40, 500, 18, 6][i],
    unit_cost: p.default_cost, valuation: [120, 40, 500, 18, 6][i] * Number(p.default_cost),
  })),
  revenue_vs_cost_dashboard: [{ revenue: 10205, payroll_cost: 8120, commission_cost: 250, net: 1835 }],
  list_chained_intakes: [],
  list_due_contract_alerts: [{ id: id(92, 1), contract_id: id(60, 1), alert_type: "renewal_upcoming", trigger_date: day(-15), status: "pending", notified_at: null, created_at: iso(-15) }],
  invoice_effective_status: (a: Record<string, unknown>) => String(invoices.find((i) => i.id === a.p_invoice_id)?.status ?? "issued"),
  get_channel_domain_trust_status: [{ confirmation_count: 1, auto_record_threshold: 3, is_trusted: false }],
};
