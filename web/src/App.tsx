import { useEffect, useState } from "react";

import { runMigrations } from "@aifa/core/db/migrations";
import type { SqlDb } from "@aifa/core/db/types";

import { BusinessCreatePage } from "./components/BusinessCreatePage";
import { WorkspaceSwitcher } from "./components/WorkspaceSwitcher";
import { DataClearedBanner } from "./components/DataClearedBanner";
import { DeviceSetupScreen } from "./components/DeviceSetupScreen";
import { SignInScreen } from "./components/SignInScreen";
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
import {
  createSupabaseTeamMembershipTransport,
  type EffectiveAccessModel,
  type MyBusinessSummary,
} from "@aifa/core/sync/teamMembershipTransport";
import { getLastSelectedWorkspace, setLastSelectedWorkspace } from "./lib/workspaceSelection";
import { supabase } from "./lib/supabaseClient";
import { AppShell } from "./shell/AppShell";

const teamMembershipTransport = createSupabaseTeamMembershipTransport(supabase);

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
  // Dev-only escape hatch (see SignInScreen.tsx's onDevBypass): lets a
  // fixed local business id stand in for a real signed-in session so the
  // app is reachable with no Supabase backend running at all. Never set
  // outside a dev build -- only SignInScreen's dev-only button calls this.
  // Untouched by Sprint 63 -- it bypasses Workspace Resolution entirely,
  // same as it always bypassed the old single-business check.
  const [devBypassBusinessId, setDevBypassBusinessId] = useState<string | null>(null);
  const userId = session?.user.id ?? null;

  // Sprint 63 (Architecture §2.1) -- Workspace Resolution. Closes the gap
  // this file's own header used to disclose ("no client anywhere in this
  // codebase yet resolves 'which business am I a member of' for a
  // signed-in user"): query every ACTIVE business_membership the login
  // holds and route accordingly.
  //   - myBusinesses === null -> still loading (or not signed in / dev bypass).
  //   - myBusinesses.length === 0 -> BusinessCreatePage.
  //   - myBusinesses.length === 1 -> auto-selected below, no picker shown.
  //   - myBusinesses.length > 1 -> WorkspaceSwitcher, unless the device
  //     remembers a still-valid last choice (workspaceSelection.ts).
  const [myBusinesses, setMyBusinesses] = useState<MyBusinessSummary[] | null>(null);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(null);
  // Bumped after BusinessCreatePage.onCreated so the list above is
  // re-fetched instead of guessed at client-side.
  const [businessesRefreshToken, setBusinessesRefreshToken] = useState(0);

  useEffect(() => {
    if (devBypassBusinessId) {
      setMyBusinesses([]); // not read on the dev-bypass path
      setSelectedBusinessId(devBypassBusinessId);
      return;
    }
    if (!userId) {
      setMyBusinesses(null);
      setSelectedBusinessId(null);
      return;
    }
    let cancelled = false;
    setMyBusinesses(null);
    setSelectedBusinessId(null);
    teamMembershipTransport
      .listMyBusinesses()
      .then((list) => {
        if (cancelled) return;
        setMyBusinesses(list);
        if (list.length === 1) {
          setSelectedBusinessId(list[0].businessId);
        } else if (list.length > 1) {
          const remembered = getLastSelectedWorkspace(userId);
          const stillValid = remembered && list.some((b) => b.businessId === remembered);
          setSelectedBusinessId(stillValid ? remembered : null);
        }
      })
      .catch(() => {
        // Best-effort: stay in the loading state on a read error rather
        // than wrongly gating either way (never silently skip past
        // BusinessCreatePage or the Workspace Switcher on a transient
        // failure) -- same discipline the old businessExists check used.
      });
    return () => {
      cancelled = true;
    };
  }, [userId, devBypassBusinessId, businessesRefreshToken]);

  const businessId = devBypassBusinessId ?? selectedBusinessId;

  function handleWorkspaceSelected(id: string): void {
    if (userId) setLastSelectedWorkspace(userId, id);
    setSelectedBusinessId(id);
  }

  const [identity, setIdentity] = useState<WebSyncIdentity | null>(null);
  const [identityChecked, setIdentityChecked] = useState(false);
  const [db, setDb] = useState<SqlDb | null>(null);
  // Sprint 40: holds the actual caught error (not just a boolean) so
  // DataClearedBanner can show LocalDataKeyMismatchError's more specific
  // message instead of always the generic "data was cleared" copy.
  const [dataClearedError, setDataClearedError] = useState<LocalDataClearedError | null>(null);

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
    setDataClearedError(null);
    openIndexedDbSqlAdapter(identity.dbKey)
      .then(async (adapter) => {
        await runMigrations(adapter);
        if (!cancelled) setDb(adapter);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof LocalDataClearedError) {
          setDataClearedError(err);
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

  // Sprint 37 (Vol 12_2 §4.4) -- sidebar visibility engine input.
  // See shell/AccessContext.tsx's own header for this call's scope:
  // Vol 13_3's solo/team signal, not yet a per-membership permission
  // list (no such read exists in this codebase yet -- disclosed there).
  const [accessModel, setAccessModel] = useState<EffectiveAccessModel>("solo");
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    const teamMembershipTransport = createSupabaseTeamMembershipTransport(supabase);
    teamMembershipTransport
      .getEffectiveAccessModel(identity.businessId)
      .then((model) => {
        if (!cancelled) setAccessModel(model);
      })
      .catch(() => {
        // Best-effort -- default 'solo' (the permissive case, per Vol 13_3
        // §2) is a safe fallback if this read fails; it never hides a
        // sidebar item that should be visible.
      });
    return () => {
      cancelled = true;
    };
  }, [identity]);

  async function handleDataClearedRetry(): Promise<void> {
    // Sprint 52: clearStoredRecoveryCode is now scoped per business_id
    // (same fix as getOrCreateWebDeviceId/storeRecoveryCode elsewhere in
    // this file's own imports) -- businessId is guaranteed non-null here
    // in practice (this banner only renders after Step 1/2's effects,
    // which require it), but TS can't see that across this closure, so
    // it's guarded explicitly rather than asserted.
    if (businessId) await clearStoredRecoveryCode(businessId);
    await clearLocalDbFile();
    setDataClearedError(null);
    setIdentity(null);
    setIdentityChecked(false);
  }

  if (sessionLoading) {
    return <p className="muted" style={{ padding: 24 }}>Loading…</p>;
  }

  if (!session && !devBypassBusinessId) {
    return (
      <SignInScreen
        onDevBypass={
          import.meta.env.DEV ? (id) => setDevBypassBusinessId(id) : undefined
        }
      />
    );
  }

  // Sprint 63 Workspace Resolution -- signed in (or dev bypass) from here.
  if (!devBypassBusinessId && myBusinesses === null) {
    return <p className="muted" style={{ padding: 24 }}>Loading…</p>;
  }

  if (!devBypassBusinessId && myBusinesses!.length === 0) {
    return <BusinessCreatePage onCreated={() => setBusinessesRefreshToken((v) => v + 1)} />;
  }

  if (!devBypassBusinessId && myBusinesses!.length > 1 && !selectedBusinessId) {
    return <WorkspaceSwitcher businesses={myBusinesses!} onSelect={handleWorkspaceSelected} />;
  }

  if (!businessId || !identityChecked) {
    return <p className="muted" style={{ padding: 24 }}>Loading…</p>;
  }

  if (dataClearedError) {
    return (
      <DataClearedBanner
        onRetry={() => void handleDataClearedRetry()}
        message={dataClearedError.message}
      />
    );
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
    <>
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
      <AppShell
        db={db}
        businessId={businessId}
        userId={userId}
        deviceId={identity.deviceId}
        dek={identity.dek}
        provider={provider}
        accessModel={accessModel}
        activeDeviceInfo={activeDeviceInfo}
      />
    </>
  );
}
