/**
 * Root shell layout — Sprint 37 (Vol 12_2, whole volume's chrome).
 *
 * Combines TopBar + Sidebar + routed content area + the AI Workspace
 * slide-over (Vol 12_2 §4.3 — "available from the top bar as a
 * persistent slide-over panel, not a sidebar page"). Every later
 * module sprint's page is added by giving its sidebar item(s) a real
 * component in the `renderContent` switch below, replacing
 * PlaceholderPage — the shell itself does not change per module sprint.
 */
import { useState } from "react";

import type { SqlDb } from "@aifa/core/db/types";
import type { AiProvider } from "@aifa/core/ai/types";
import type { EffectiveAccessModel } from "@aifa/core/sync/teamMembershipTransport";

import { DevicesPanel } from "../components/DevicesPanel";
import { Workspace } from "../components/Workspace";
import type { ActiveDeviceInfo } from "../lib/syncService";

import { AccessProvider } from "./AccessContext";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { PlaceholderPage } from "./PlaceholderPage";
import { CaptureRouterPage } from "./pages/CaptureRouterPage";
import { ForwardToAifaPage } from "./pages/ForwardToAifaPage";
import { MembersPage } from "./pages/MembersPage";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { PartiesPage } from "./pages/PartiesPage";
import { ChartOfAccountsPage } from "./pages/ChartOfAccountsPage";
import { LedgerPage } from "./pages/LedgerPage";
import { PricingCatalogPage } from "./pages/PricingCatalogPage";
import { QuotationsPage } from "./pages/QuotationsPage";
import { InvoicesPage } from "./pages/InvoicesPage";
import { PaymentsCreditNotesPage } from "./pages/PaymentsCreditNotesPage";
import { ArAgeingPage } from "./pages/ArAgeingPage";
import { PaymentVouchersPage } from "./pages/PaymentVouchersPage";
import { PurchaseOrdersPage } from "./pages/PurchaseOrdersPage";
import { ExpenseQuickCapturePage } from "./pages/ExpenseQuickCapturePage";
import { CashBookPlPage } from "./pages/CashBookPlPage";
import { ProductsStockPage } from "./pages/ProductsStockPage";
import { DeliveryOrdersPage } from "./pages/DeliveryOrdersPage";
import { FullReportsPage } from "./pages/FullReportsPage";
import { EInvoiceSstPage } from "./pages/EInvoiceSstPage";
import { PayrollPage } from "./pages/PayrollPage";
import { AttendanceLeavePage } from "./pages/AttendanceLeavePage";
import { CommissionPage } from "./pages/CommissionPage";
import { ContractsAlertsPage } from "./pages/ContractsAlertsPage";
import { ESignaturePage } from "./pages/ESignaturePage";
import { BusinessOverviewPage } from "./pages/BusinessOverviewPage";
import { BusinessSettingsPage } from "./pages/BusinessSettingsPage";
import { SIDEBAR_ITEMS_BY_ID, DEFAULT_SIDEBAR_ITEM_ID } from "./sidebarConfig";

interface Props {
  db: SqlDb;
  businessId: string;
  userId: string | null;
  deviceId: string;
  dek: Uint8Array;
  provider: AiProvider;
  accessModel: EffectiveAccessModel;
  activeDeviceInfo: ActiveDeviceInfo | null;
}

export function AppShell({
  db,
  businessId,
  userId,
  deviceId,
  dek,
  provider,
  accessModel,
  activeDeviceInfo,
}: Props): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [activeItemId, setActiveItemId] = useState(DEFAULT_SIDEBAR_ITEM_ID);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  const activeItem = SIDEBAR_ITEMS_BY_ID[activeItemId];

  function renderContent(): JSX.Element {
    // Sprint 37 wires the three items an existing Phase 1/2 component
    // already covers (see sidebarConfig.ts's `status` field); every
    // other item is its own future sprint's placeholder.
    switch (activeItemId) {
      case "business-overview":
        return <BusinessOverviewPage businessId={businessId} onGoToApprovals={() => setActiveItemId("approvals")} />;
      case "quick-capture":
        return <CaptureRouterPage businessId={businessId} onGoToApprovals={() => setActiveItemId("approvals")} />;
      case "forward-to-aifa":
        return <ForwardToAifaPage businessId={businessId} onGoToApprovals={() => setActiveItemId("approvals")} />;
      case "members-roles":
        return <MembersPage businessId={businessId} />;
      case "approvals":
        return <ApprovalsPage businessId={businessId} />;
      case "parties":
        return <PartiesPage businessId={businessId} />;
      case "chart-of-accounts":
        return <ChartOfAccountsPage businessId={businessId} />;
      case "ledger":
        return <LedgerPage businessId={businessId} />;
      case "pricing-catalog":
        return <PricingCatalogPage businessId={businessId} />;
      case "quotations":
        return <QuotationsPage businessId={businessId} onGoToApprovals={() => setActiveItemId("approvals")} />;
      case "invoices":
        return <InvoicesPage businessId={businessId} />;
      case "payments-credit-notes":
        return <PaymentsCreditNotesPage businessId={businessId} />;
      case "ar-ageing":
        return <ArAgeingPage businessId={businessId} />;
      case "payment-vouchers":
        return <PaymentVouchersPage businessId={businessId} onGoToApprovals={() => setActiveItemId("approvals")} />;
      case "purchase-orders":
        return <PurchaseOrdersPage businessId={businessId} onGoToApprovals={() => setActiveItemId("approvals")} />;
      case "expense":
        return <ExpenseQuickCapturePage businessId={businessId} onGoToPaymentVouchers={() => setActiveItemId("payment-vouchers")} />;
      case "cash-book-pl":
        return <CashBookPlPage businessId={businessId} />;
      case "products-stock":
        return <ProductsStockPage businessId={businessId} />;
      case "delivery-orders":
        return <DeliveryOrdersPage businessId={businessId} onGoToApprovals={() => setActiveItemId("approvals")} />;
      case "full-reports":
        return <FullReportsPage businessId={businessId} />;
      case "einvoice-sst":
        return <EInvoiceSstPage businessId={businessId} />;
      case "payroll":
        return <PayrollPage businessId={businessId} onGoToApprovals={() => setActiveItemId("approvals")} />;
      case "attendance-leave":
        return <AttendanceLeavePage businessId={businessId} onGoToApprovals={() => setActiveItemId("approvals")} />;
      case "commission":
        return <CommissionPage businessId={businessId} onGoToApprovals={() => setActiveItemId("approvals")} />;
      case "contracts-alerts":
        return <ContractsAlertsPage businessId={businessId} onGoToApprovals={() => setActiveItemId("approvals")} />;
      case "esignature":
        return <ESignaturePage businessId={businessId} />;
      case "devices":
        return <DevicesPanel db={db} businessId={businessId} deviceId={deviceId} dek={dek} />;
      case "business-settings":
        return <BusinessSettingsPage db={db} businessId={businessId} deviceId={deviceId} dek={dek} />;
      default:
        return <PlaceholderPage item={activeItem} />;
    }
  }

  return (
    <AccessProvider accessModel={accessModel} businessId={businessId} userId={userId}>
      <div className="aifa-shell">
        <TopBar
          onToggleSidebar={() => setCollapsed((c) => !c)}
          businessLabel="AiFA"
          activeDeviceInfo={activeDeviceInfo}
          onOpenWorkspace={() => setWorkspaceOpen(true)}
        />
        <div className="aifa-shell-body">
          <Sidebar collapsed={collapsed} activeItemId={activeItemId} onSelect={setActiveItemId} />
          <main className="aifa-content">{renderContent()}</main>
        </div>
        {workspaceOpen && (
          <div
            className="aifa-workspace-slideover"
            role="dialog"
            aria-label="AI Workspace"
            onKeyDown={(e) => {
              if (e.key === "Escape") setWorkspaceOpen(false);
            }}
          >
            <div className="aifa-workspace-slideover-header">
              <span>AI Workspace</span>
              <button aria-label="Close AI Workspace" onClick={() => setWorkspaceOpen(false)}>
                ✕
              </button>
            </div>
            <div className="aifa-workspace-slideover-body">
              <Workspace db={db} provider={provider} businessId={businessId} />
            </div>
          </div>
        )}
      </div>
    </AccessProvider>
  );
}
