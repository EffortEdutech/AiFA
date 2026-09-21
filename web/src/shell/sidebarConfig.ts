/**
 * Sidebar information architecture — Sprint 37 (Vol 12_2 §4.2).
 *
 * This is the single source of truth for "what's in the sidebar" — the
 * nineteen items across nine sections Vol 12_2 §4.2 specifies. Every
 * later module sprint (38-47) claims its own item(s) here by replacing
 * that item's `status: "placeholder"` component with its real page —
 * the sidebar/routing/visibility engine itself does not change per
 * module sprint, only this table's `component` field does.
 *
 * `domain` is the Vol 13_1 §3 permission-catalog domain gating this
 * item's visibility (Section 4.4) — `null` means always visible to any
 * active membership (e.g. Overview, Approvals, Devices). A page whose
 * own actions need finer-grained (capture vs configure) gating enforces
 * that at the action level, not by hiding the whole sidebar item.
 */
import type { Domain } from "@aifa/core/sync/approvalEngineTransport";

export interface SidebarItem {
  id: string;
  label: string;
  /** Vol 13_1 §3 domain this item is gated on, or null for "always visible". */
  domain: Domain | null;
  /** Which Phase 4 sprint (Vol 12_2 §9) claims this item's real page. */
  sprint: number;
  /** Sprint 37 ships every item as a placeholder except where an
   * existing Phase 1/2 component already covers it (Overview, Devices,
   * Business Settings) — see Section "no regression" in this sprint's
   * own DoD. */
  status: "placeholder" | "existing";
}

export interface SidebarSection {
  id: string;
  label: string;
  items: SidebarItem[];
}

export const SIDEBAR: SidebarSection[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      { id: "business-overview", label: "Business Overview", domain: null, sprint: 48, status: "existing" },
    ],
  },
  {
    // 14 September 2026 fix: CaptureRouterPage.tsx ("Quick Capture (AI)",
    // Sprint 53) and ForwardToAifaPage.tsx ("Forward to AiFA", Sprint 54)
    // were both built assuming a sidebar entry — each page's own copy
    // literally says "Forwarding something instead? Use Forward to AiFA
    // in the sidebar" — but neither was ever actually added here or given
    // a case in AppShell.tsx's switch. This predates today's Sales/PO
    // work; found only because the owner asked why the sidebar had no way
    // to send/forward a capture to AiFA at all. domain: null, matching
    // Approvals/Devices — capture spans every domain, gated per-submission
    // by each domain's own capability check inside useCaptureRouterCore.
    id: "capture",
    label: "Capture",
    items: [
      { id: "quick-capture", label: "Quick Capture (AI)", domain: null, sprint: 53, status: "existing" },
      { id: "forward-to-aifa", label: "Forward to AiFA", domain: null, sprint: 54, status: "existing" },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    items: [
      { id: "parties", label: "Parties (Customers/Suppliers)", domain: "sales", sprint: 39, status: "existing" },
      { id: "pricing-catalog", label: "Pricing & Catalog", domain: "pricing", sprint: 39, status: "existing" },
      { id: "quotations", label: "Quotations", domain: "sales", sprint: 40, status: "existing" },
      { id: "invoices", label: "Invoices", domain: "sales", sprint: 40, status: "existing" },
      { id: "payments-credit-notes", label: "Payments & Credit Notes", domain: "sales", sprint: 40, status: "existing" },
      { id: "ar-ageing", label: "AR Ageing", domain: "accounting_reports", sprint: 40, status: "existing" },
    ],
  },
  {
    id: "purchases-cash",
    label: "Purchases & Cash",
    items: [
      { id: "payment-vouchers", label: "Payment Vouchers", domain: "expense", sprint: 41, status: "existing" },
      { id: "expense", label: "Expense", domain: "expense", sprint: 41, status: "existing" },
      { id: "purchase-orders", label: "Purchase Orders", domain: "expense", sprint: 58, status: "existing" },
      { id: "cash-book-pl", label: "Cash Book / P&L", domain: "accounting_reports", sprint: 41, status: "existing" },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    items: [
      { id: "products-stock", label: "Products & Stock", domain: "inventory", sprint: 42, status: "existing" },
      { id: "delivery-orders", label: "Delivery Orders", domain: "inventory", sprint: 42, status: "existing" },
    ],
  },
  {
    id: "accounting",
    label: "Accounting",
    items: [
      { id: "chart-of-accounts", label: "Chart of Accounts", domain: "settings", sprint: 39, status: "existing" },
      { id: "ledger", label: "Ledger", domain: "accounting_reports", sprint: 39, status: "existing" },
      { id: "full-reports", label: "Full Reports & Bank Reconciliation", domain: "accounting_reports", sprint: 43, status: "existing" },
    ],
  },
  {
    id: "compliance",
    label: "Compliance",
    items: [
      { id: "einvoice-sst", label: "e-Invoice & SST", domain: "tax_compliance", sprint: 44, status: "existing" },
    ],
  },
  {
    id: "people",
    label: "People",
    items: [
      { id: "payroll", label: "Payroll", domain: "payroll", sprint: 45, status: "existing" },
      { id: "attendance-leave", label: "Attendance & Leave", domain: "hr_attendance_leave", sprint: 46, status: "existing" },
      { id: "commission", label: "Commission", domain: "commission", sprint: 46, status: "existing" },
    ],
  },
  {
    id: "legal",
    label: "Legal",
    items: [
      { id: "contracts-alerts", label: "Contracts & Alerts", domain: "legal_contract", sprint: 47, status: "existing" },
      { id: "esignature", label: "e-Signature", domain: "legal_contract", sprint: 47, status: "existing" },
    ],
  },
  {
    id: "team",
    label: "Team",
    items: [
      { id: "members-roles", label: "Members & Roles", domain: null, sprint: 38, status: "existing" },
      { id: "approvals", label: "Approvals", domain: null, sprint: 38, status: "existing" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    items: [
      { id: "devices", label: "Devices", domain: null, sprint: 38, status: "existing" },
      { id: "business-settings", label: "Business Settings", domain: "settings", sprint: 48, status: "existing" },
    ],
  },
];

/** Flat lookup, built once — every sidebar item id must be unique across
 * the whole table; this throws early (module load time) rather than
 * letting a duplicate id silently shadow another item's route. */
export const SIDEBAR_ITEMS_BY_ID: Record<string, SidebarItem> = (() => {
  const map: Record<string, SidebarItem> = {};
  for (const section of SIDEBAR) {
    for (const item of section.items) {
      if (map[item.id]) {
        throw new Error(`Duplicate sidebar item id: ${item.id}`);
      }
      map[item.id] = item;
    }
  }
  return map;
})();

export const DEFAULT_SIDEBAR_ITEM_ID = "business-overview";
