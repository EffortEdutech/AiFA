/**
 * Sprint 9 (Vol 7_4 §3) — the cross-cutting offline indicator, rendered
 * once in App.tsx rather than duplicated per-screen (App.tsx's own
 * comment already anticipated this: "Notifications and offline state are
 * cross-cutting, not separate screens"). Deliberately minimal: a single
 * unobtrusive strip, shown only while offline, not a modal or anything
 * that blocks interaction — capture still works fully offline (Vol 7_4
 * §2), this is purely informational.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

export function ConnectivityBanner({ isOnline }: { isOnline: boolean }) {
  if (isOnline) return null;

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.text}>
        Offline — anything you capture is saved and will process once
        you&apos;re back online.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "#4a3b0a",
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  text: {
    color: "#fff6e5",
    fontSize: 12,
    textAlign: "center",
  },
});
