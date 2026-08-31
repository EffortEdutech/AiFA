import { updateBusinessProfile } from "@aifa/core/db/appSettingsRepository";
import { canProceedFromProfileStep } from "@aifa/core/onboarding/onboardingValidation";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { getDb, getLocalBusinessId, setOnboardingCompleted } from "@/db/client";

/**
 * First-run onboarding — Sprint 12, Vol 7_1 Section 4 ("a short explanation
 * of how capture works" + business profile setup). Shown exactly once per
 * device, gated by `db/client.ts`'s SecureStore-backed
 * `getHasCompletedOnboarding`/`setOnboardingCompleted` (App.tsx checks this
 * on mount and renders this component instead of the normal tab navigator
 * until it completes).
 *
 * Three steps, deliberately short (Vol 1_2's "single-input-first"
 * principle applies here too -- onboarding itself should not become a
 * multi-screen chore): Welcome (what AIFA does and how capture/confirm
 * works), Business Profile (reuses Sprint 10's `updateBusinessProfile` --
 * the same data Settings edits later, not a separate onboarding-only
 * table), and Done. Skipping the profile step is allowed (business name is
 * optional here, same as in Settings) -- onboarding must never block an
 * owner from reaching the app, matching Vol 4_4's local-first/never-gate
 * principle already applied to Sprint 10's optional Account sign-in.
 */
export function OnboardingFlow({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<"welcome" | "profile" | "done">("welcome");
  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleProfileNext() {
    setSaving(true);
    try {
      if (canProceedFromProfileStep(businessName)) {
        const db = await getDb();
        const businessId = await getLocalBusinessId();
        await updateBusinessProfile(db, businessId, {
          businessName: businessName.trim(),
          industry: industry.trim() || null,
        });
      }
      setStep("done");
    } finally {
      setSaving(false);
    }
  }

  async function handleFinish() {
    await setOnboardingCompleted();
    onComplete();
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.container}>
        {step === "welcome" && (
          <View style={styles.card}>
            <Text style={styles.heading}>Welcome to AiFA</Text>
            <Text style={styles.tagline}>One Input. AI Does the Rest.</Text>
            <Text style={styles.bodyText}>
              Capture a sale, purchase, expense, or bank transaction by typing a
              short note or taking a photo of a receipt or invoice.
            </Text>
            <Text style={styles.bodyText}>
              AIFA reads it, works out the bookkeeping, and either records it
              automatically (when it's confident), asks you to confirm a guess,
              or asks a quick clarifying question — never silently guessing when
              it isn't sure.
            </Text>
            <Text style={styles.bodyText}>
              Everything you capture is saved on this device instantly, even
              offline. You can always see, and correct, anything AIFA recorded.
            </Text>
            <Pressable
              style={styles.button}
              onPress={() => setStep("profile")}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>Next</Text>
            </Pressable>
          </View>
        )}

        {step === "profile" && (
          <View style={styles.card}>
            <Text style={styles.heading}>Tell us about your business</Text>
            <Text style={styles.bodyText}>
              Optional — you can also set this later in Settings.
            </Text>
            <Text style={styles.label}>Business name</Text>
            <TextInput
              style={styles.input}
              value={businessName}
              onChangeText={setBusinessName}
              placeholder="Your business name"
            />
            <Text style={styles.label}>Industry</Text>
            <TextInput
              style={styles.input}
              value={industry}
              onChangeText={setIndustry}
              placeholder="e.g. Retail, Consulting"
            />
            <Pressable
              style={styles.button}
              onPress={handleProfileNext}
              disabled={saving}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>
                {saving ? "Saving…" : "Next"}
              </Text>
            </Pressable>
          </View>
        )}

        {step === "done" && (
          <View style={styles.card}>
            <Text style={styles.heading}>You're all set</Text>
            <Text style={styles.bodyText}>
              Head to the Capture tab whenever something happens in your
              business — a sale, a purchase, an expense, or a bank transaction.
              Settings has more options (notifications, backup, export) whenever
              you want them.
            </Text>
            <Pressable
              style={styles.button}
              onPress={handleFinish}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>Get started</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: "center", padding: 20 },
  card: { gap: 12 },
  heading: { fontSize: 24, fontWeight: "700", color: "#222" },
  tagline: { fontSize: 15, fontWeight: "600", color: "#2563eb" },
  bodyText: { fontSize: 15, color: "#333", lineHeight: 21 },
  label: { fontSize: 13, color: "#555", marginTop: 4 },
  input: {
    backgroundColor: "#f2f2f2",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  button: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
