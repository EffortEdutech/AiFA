import "react-native-url-polyfill/auto";
import { NavigationContainer } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ConnectivityBanner } from "@/components/ConnectivityBanner";
import { OnboardingFlow } from "@/components/OnboardingFlow";
import { getHasCompletedOnboarding } from "@/db/client";
import { useAutoResume } from "@/hooks/useAutoResume";
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

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <ConnectivityBanner isOnline={isOnline} />
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
