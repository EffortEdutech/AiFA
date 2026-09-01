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
  clearBusinessDekCryptoKey,
} from "./lib/keyStore";
import {
  restoreWebSyncIdentity,
  type WebSyncIdentity,
} from "./lib/deviceBootstrap";
import { LocalDataClearedError, openIndexedDbSqlAdapter, clearLocalDbFile } from "./lib/sqlJsAdapter";

type Tab = "dashboard" | "capture" | "workspace" | "settings";

/**
 * Sprint 18 root component. Layering, outside-in: auth (Supabase, same
 * backend as mobile) -> per-browser device/DEK setup (Vol 12_0 §6a) ->
 * the encrypted local SQL database (sql.js + IndexedDB, sqlJsAdapter.ts)
 * -> the Phase 2a feature slice itself. No SyncContext is set anywhere
 * here — sync is explicitly Sprint 19's job (this sprint's Objectives),
 * so every @aifa/core write below runs exactly as it would in any
 * pre-Sprint-16 test: ungated, unqueued (see syncContext.ts's own doc for
 * why that's the deliberately safe default with no context set).
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
    openIndexedDbSqlAdapter(identity.dek)
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

  async function handleDataClearedRetry(): Promise<void> {
    await Promise.all([clearBusinessDekCryptoKey(), clearLocalDbFile()]);
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
        <SettingsReadOnly db={db} businessId={businessId} deviceId={identity.deviceId} />
      )}
    </div>
  );
}
