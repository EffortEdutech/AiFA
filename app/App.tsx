import "react-native-url-polyfill/auto";
import { NavigationContainer } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ConnectivityBanner } from "@/components/ConnectivityBanner";
import { DemotedOutboxReview } from "@/components/DemotedOutboxReview";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import { ReadOnlyBanner } from "@/components/ReadOnlyBanner";
import { getHasCompletedOnboarding } from "@/db/client";
import { restoreSyncContextIfBootstrapped } from "@/db/syncBootstrap";
import { useActiveDeviceInfo } from "@/hooks/useActiveDeviceInfo";
import { useAutoResume } from "@/hooks/useAutoResume";
import { useDemotionPoll } from "@/hooks/useDemotionPoll";
import { useSyncResume } from "@/hooks/useSyncResume";
import { useAuthSession } from "@/lib/auth";
import { installCrashReporting } from "@/lib/crashReporting";
import AppNavigator from "@/navigation/AppNavigator";

// App shell per docs/architecture/v2.0/Series_07_Mobile_Application_Architecture/Vol_7_0.
// Five top-level surfaces: Capture, AI Workspace, Dashboard, Documents, Settings.
// Notifications and offline state are cross-cutting, not separate screens (Vol 7_0 Section 3).
//
// Sprint 9 (Vol 7_4): `useAutoResume` is the single place that decides
// when to retry queued/stuck AI interpretation work (on mount and on
// reconnect); `ConnectivityBanner` is the single place that shows the
// owner they're offline. Both live here, at the app root, rather than
// duplicated into each of the five screens above.
//
// Sprint 11 (Vol 8_6): `installCrashReporting` is called once at module
// load, before the component even mounts, so it can catch errors as early
// as possible in the app's lifecycle -- not deferred to a useEffect.
installCrashReporting();

// Sprint 12 (Vol 7_1 Section 4): a device that has never completed
// onboarding sees OnboardingFlow instead of the normal tab navigator,
// checked once via SecureStore (db/client.ts) on mount. This never blocks
// `useAutoResume`/`ConnectivityBanner` from running -- those are
// cross-cutting and harmless to run even before onboarding finishes (a
// fresh install has nothing queued to resume yet).
export default function App() {
  const { isOnline } = useAutoResume();
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    let isMounted = true;
    getHasCompletedOnboarding().then((completed) => {
      if (!isMounted) return;
      setNeedsOnboarding(!completed);
      setOnboardingChecked(true);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Sprint 17 -- closes the gap that sprint's own runbook flagged: until
  // now, nothing anywhere called initMobileSync, so Sprint 16/17's sync
  // UI was built and unit-tested but never actually reachable. Mirrors
  // the onboarding check just above: re-derive the sync context (if this
  // device already completed the one-time setup in SettingsScreen's Sync
  // card) whenever the auth session changes, since business_id for sync
  // purposes IS the signed-in owner's auth.uid() (Sprint 14). Signing in
  // and completing sync setup are both optional and never block the rest
  // of the app (Vol 4_4 Section 2, local-first) -- syncBusinessId/
  // syncDeviceId/syncDek simply stay null until an owner opts in, the
  // same fully-permissive state every pre-Sprint-16 screen already ran
  // in.
  const { session } = useAuthSession();
  const [syncBusinessId, setSyncBusinessId] = useState<string | null>(null);
  const [syncDeviceId, setSyncDeviceId] = useState<string | null>(null);
  const [syncDek, setSyncDek] = useState<Uint8Array | null>(null);

  useEffect(() => {
    let isMounted = true;
    const businessId = session?.user.id ?? null;

    restoreSyncContextIfBootstrapped(businessId).then((restored) => {
      if (!isMounted) return;
      if (restored) {
        setSyncBusinessId(businessId);
        setSyncDeviceId(restored.deviceId);
        setSyncDek(restored.dek);
      } else {
        setSyncBusinessId(null);
        setSyncDeviceId(null);
        setSyncDek(null);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [session]);

  const { demotedOutboxReview } = useSyncResume(
    syncBusinessId,
    syncDeviceId,
    syncDek,
  );
  useDemotionPoll(syncBusinessId, isOnline);
  const { info: activeDeviceInfo, refresh: refreshActiveDeviceInfo } =
    useActiveDeviceInfo(syncBusinessId, syncDeviceId, isOnline);

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <ConnectivityBanner isOnline={isOnline} />
        {syncBusinessId && syncDeviceId && syncDek && activeDeviceInfo && (
          <ReadOnlyBanner
            isActiveDevice={activeDeviceInfo.isActiveDevice}
            activeDeviceId={activeDeviceInfo.activeDeviceId}
            activeDeviceLabel={activeDeviceInfo.activeDeviceLabel}
            activeDeviceIsPrimary={activeDeviceInfo.activeDeviceIsPrimary}
            activeDeviceLastSeenAt={activeDeviceInfo.activeDeviceLastSeenAt}
            requestingIsPrimary={activeDeviceInfo.requestingIsPrimary}
            businessId={syncBusinessId}
            deviceId={syncDeviceId}
            dek={syncDek}
            onActivated={refreshActiveDeviceInfo}
          />
        )}
        {syncBusinessId && demotedOutboxReview && (
          <DemotedOutboxReview
            businessId={syncBusinessId}
            review={demotedOutboxReview}
          />
        )}
        {!onboardingChecked ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator />
          </View>
        ) : needsOnboarding ? (
          <OnboardingFlow onComplete={() => setNeedsOnboarding(false)} />
        ) : (
          <AppNavigator />
        )}
      </NavigationContainer>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
});
