/**
 * Business Overview — temporary Sprint 37 composition.
 *
 * Vol 12_2 §5.1/§9 assigns the real, four-tab (Snapshot / Sales
 * Pipeline / Compliance Status / Team Activity) Business Overview to
 * Sprint 48, once every module sprint it draws from has shipped. Until
 * then, this sprint must not regress the existing Phase 1/2 Dashboard
 * or Capture flows (this sprint's own DoD) — so this page wraps the
 * two already-working components (Dashboard, CaptureForm) behind the
 * shared TabStrip, clearly labelled as the interim state, rather than
 * either dropping them or prematurely building Sprint 48's real design.
 */
import { useState } from "react";

import type { SqlDb } from "@aifa/core/db/types";

import { Dashboard } from "../components/Dashboard";
import { CaptureForm } from "../components/CaptureForm";
import { TabStrip } from "./TabStrip";
import type { AiProvider } from "@aifa/core/ai/types";

type OverviewTab = "snapshot" | "quick-capture";

interface Props {
  db: SqlDb;
  businessId: string;
  provider: AiProvider;
}

export function OverviewPage({ db, businessId, provider }: Props): JSX.Element {
  const [tab, setTab] = useState<OverviewTab>("snapshot");
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <div className="aifa-page">
      <h1>Business Overview</h1>
      <p className="muted">
        Sprint 48 replaces this with the full Snapshot / Sales Pipeline / Compliance Status /
        Team Activity tab set (Vol 12_2 §5.1). This interim view keeps the existing dashboard
        and capture flows working in the meantime.
      </p>
      <TabStrip
        tabs={[
          { id: "snapshot", label: "Snapshot" },
          { id: "quick-capture", label: "Quick Capture" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "snapshot" && <Dashboard db={db} businessId={businessId} refreshToken={refreshToken} />}
      {tab === "quick-capture" && (
        <CaptureForm
          db={db}
          provider={provider}
          businessId={businessId}
          onCaptured={() => setRefreshToken((n) => n + 1)}
        />
      )}
    </div>
  );
}
