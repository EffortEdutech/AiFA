import { useEffect, useState } from "react";

import { runMigrations } from "@aifa/core/db/migrations";
import type { SqlDb } from "@aifa/core/db/types";

import { CaptureForm } from "./components/CaptureForm";
import { Dashboard } from "./components/Dashboard";
import { DataClearedBanner } from "./components/DataClearedBanner";
import { DeviceSetupScreen } from "./components/DeviceSetupScreen";
import { SettingsReadOnly } from "./components/SettingsReadOnly";
import { SignInScreen } from "./components/SignInScreen";
import { Workspace } from "./components/Workspace";
import { getDefaultWebProvider } from "./lib/aiProvider";
import { useAuthSession } from "./lib/auth";
import {
  clearStoredRecoveryCode,
} from "./lib/keyStore";
import {
  restoreWebSyncIdentity,
  type WebSyncIdentity,
} from "./lib/deviceBootstrap";
import { LocalDataClearedError, openIndexedDbSqlAdapter, clearLocalDbFile } from "./lib/sqlJsAdapter";
import { initWebSync } from "./lib/syncService";
import { useWebSync } from "./hooks/useWebSync";
import { ReadOnlyBanner } from "./components/ReadOnlyBanner";
import { DemotedOutboxReview } from "./components/DemotedOutboxReview";

type Tab = "dashboard" | "capture" | "workspace" | "settings";

/**
 * Root component. Layering, outside-in: auth (Supabase, same backend as
 * mobile) -> per-browser device/DEK setup (Vol 12_0 §6a) -> the
 * encrypted local SQL database (sql.js + IndexedDB, sqlJsAdapter.ts) ->
 * sync (Sprint 19: initWebSync sets the ambient SyncContext once the
 * identity+db are both ready, useWebSync.ts runs the actual cycles) ->
 * the feature slice itself.
 */
export default function App(): JSX.Element {
  const { session, isLoading: sessionLoading } = useAuthSession();
  const businessId = session?.user.id ?? null;

  const [identity, setIdentity] = useState<WebSyncIdentity | null>(null);
  const [identityChecked, setIdentityChecked] = useState(false);
  const [db, setDb] = useState<SqlDb | null>(null);
  const [dataCleared, setDataCleared] = useState(false);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [refreshToken, setRefreshToken] = useState(0);

  // Step 1: once signed in, see if this browser already completed setup.
  useEffect(() => {
    if (!businessId) {
      setIdentity(null);
      setIdentityChecked(false);
      setDb(null);
      return;
    }
    let cancelled = false;
    restoreWebSyncIdentity(businessId).then((restored) => {
      if (cancelled) return;
      setIdentity(restored);
      setIdentityChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  // Step 2: once we have a device/DEK identity, open (or create) the
  // encrypted local database and run migrations.
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    setDataCleared(false);
    openIndexedDbSqlAdapter(identity.dbKey)
      .then(async (adapter) => {
        await runMigrations(adapter);
        if (!cancelled) setDb(adapter);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof LocalDataClearedError) {
          setDataCleared(true);
        } else {
          throw err;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [identity]);

  // Step 3 (Sprint 19): once both the identity and the local db are
  // ready, set the ambient SyncContext so every @aifa/core write from
  // here on is gated and queued for sync -- mirrors mobile's
  // syncBootstrap.ts calling initMobileSync at the equivalent point.
  useEffect(() => {
    if (!identity || !db) return;
    initWebSync(identity.businessId, identity.deviceId, identity.dek);
  }, [identity, db]);

  const { activeDeviceInfo, refreshActiveDeviceInfo, demotedOutboxReview } = useWebSync(
    db,
    identity?.businessId ?? null,
    identity?.deviceId ?? null,
    identity?.dek ?? null,
  );

  async function handleDataClearedRetry(): Promise<void> {
    await Promise.all([clearStoredRecoveryCode(), clearLocalDbFile()]);
    setDataCleared(false);
    setIdentity(null);
    setIdentityChecked(false);
  }

  if (sessionLoading || (businessId && !identityChecked)) {
    return <p className="muted" style={{ padding: 24 }}>Loading…</p>;
  }

  if (!session || !businessId) {
    return <SignInScreen />;
  }

  if (dataCleared) {
    return <DataClearedBanner onRetry={() => void handleDataClearedRetry()} />;
  }

  if (!identity) {
    return (
      <DeviceSetupScreen
        businessId={businessId}
        onReady={(readyIdentity) => setIdentity(readyIdentity)}
      />
    );
  }

  if (!db) {
    return <p className="muted" style={{ padding: 24 }}>Opening your local data…</p>;
  }

  const provider = getDefaultWebProvider();

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}>
      {identity && activeDeviceInfo && (
        <ReadOnlyBanner
          db={db}
          businessId={identity.businessId}
          deviceId={identity.deviceId}
          dek={identity.dek}
          info={activeDeviceInfo}
          onActivated={refreshActiveDeviceInfo}
        />
      )}
      {identity && demotedOutboxReview && (
        <DemotedOutboxReview
          db={db}
          businessId={identity.businessId}
          review={demotedOutboxReview}
        />
      )}
      <h1 style={{ fontSize: 22 }}>AiFA</h1>
      <div className="tabs" role="tablist">
        {(["dashboard", "capture", "workspace", "settings"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "dashboard" && (
        <Dashboard db={db} businessId={businessId} refreshToken={refreshToken} />
      )}
      {tab === "capture" && (
        <CaptureForm
          db={db}
          provider={provider}
          businessId={businessId}
          onCaptured={() => setRefreshToken((n) => n + 1)}
        />
      )}
      {tab === "workspace" && (
        <Workspace db={db} provider={provider} businessId={businessId} />
      )}
      {tab === "settings" && (
        <SettingsReadOnly db={db} businessId={businessId} deviceId={identity.deviceId} dek={identity.dek} />
      )}
    </div>
  );
}
