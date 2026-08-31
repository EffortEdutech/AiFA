import {
  getAppSettings,
  updateBusinessProfile,
  updateNotificationPreferences,
  type AppSettings,
} from "@aifa/core/db/appSettingsRepository";
import { deleteAllLocalData } from "@aifa/core/db/deletionRepository";
import {
  getDiagnosticsSummary,
  type DiagnosticsSummary,
} from "@aifa/core/db/diagnosticsRepository";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import accountingRules from "../../../packages/core/pka/accounting_rules.json";

import BYOKSettingsCard from "@/components/BYOKSettingsCard";
import { getDb, getDeviceEncryptionKey, getLocalBusinessId } from "@/db/client";
import { deleteRemoteAccountData } from "@/db/deletionService";
import { writeExportFiles } from "@/db/exportService";
import { requestOtp, signOut, useAuthSession, verifyOtp } from "@/lib/auth";

/**
 * Settings & Business Configuration — Vol 7_7, Sprint 10 concrete build.
 * Covers four of the six configuration domains in that volume's table:
 * Business Profile, Notifications (full quiet-hours + per-kind control),
 * Finance PKA Management (read-only version display), and Data & Privacy
 * (export, backup recovery, deletion). AI Autonomy and Access & Team stay
 * unbuilt on purpose — both are Phase 2 (Vol 0_1 §4, Vol 8_1 §4); no
 * placeholder toggle for either appears here, since a visible-but-fake
 * control would misrepresent what Phase 1 actually does (Vol 1_2's
 * explainability/trust principle).
 *
 * Account sign-in is deliberately NOT a gate on this screen or the rest of
 * the app (Vol 4_4 §2, local-first) — it is one optional section among
 * several, unlocking backup/restore and remote-account deletion only.
 */
export default function SettingsScreen() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [industry, setIndustry] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSavedAt, setProfileSavedAt] = useState<string | null>(null);

  const [quietHoursEnabled, setQuietHoursEnabled] = useState(true);
  const [quietHoursStartHour, setQuietHoursStartHour] = useState("21");
  const [quietHoursEndHour, setQuietHoursEndHour] = useState("8");
  const [notifyActionNeeded, setNotifyActionNeeded] = useState(true);
  const [notifyConfirmationRequest, setNotifyConfirmationRequest] =
    useState(true);
  const [notificationsSaving, setNotificationsSaving] = useState(false);
  const [notificationsSavedAt, setNotificationsSavedAt] = useState<
    string | null
  >(null);

  const { session, isLoading: authLoading } = useAuthSession();
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpStage, setOtpStage] = useState<"email" | "code">("email");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  const [recoveryCodeRevealed, setRecoveryCodeRevealed] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const [exportBusy, setExportBusy] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);

  const [deleteBusy, setDeleteBusy] = useState(false);

  const [diagnostics, setDiagnostics] = useState<DiagnosticsSummary | null>(
    null,
  );
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const db = await getDb();
      const id = await getLocalBusinessId();
      const loaded = await getAppSettings(db, id);
      setBusinessId(id);
      setSettings(loaded);
      setBusinessName(loaded.business_name ?? "");
      setIndustry(loaded.industry ?? "");
      setQuietHoursEnabled(loaded.quiet_hours_enabled);
      setQuietHoursStartHour(String(loaded.quiet_hours_start_hour));
      setQuietHoursEndHour(String(loaded.quiet_hours_end_hour));
      setNotifyActionNeeded(loaded.notify_action_needed);
      setNotifyConfirmationRequest(loaded.notify_confirmation_request);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load settings.",
      );
    }
    // Diagnostics (Vol 8_6 Section 4) is loaded as its own independent
    // try/catch -- a failure here must never block Business
    // Profile/Notifications from loading and being editable, and vice
    // versa; each card degrades on its own.
    try {
      const db = await getDb();
      const id = await getLocalBusinessId();
      setDiagnostics(await getDiagnosticsSummary(db, id));
    } catch (err) {
      setDiagnosticsError(
        err instanceof Error ? err.message : "Failed to load diagnostics.",
      );
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSaveProfile() {
    if (!businessId) return;
    setProfileSaving(true);
    try {
      const db = await getDb();
      const updated = await updateBusinessProfile(db, businessId, {
        businessName: businessName.trim() || null,
        industry: industry.trim() || null,
      });
      setSettings(updated);
      setProfileSavedAt(updated.updated_at);
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleSaveNotifications() {
    if (!businessId) return;
    setNotificationsSaving(true);
    try {
      const db = await getDb();
      const updated = await updateNotificationPreferences(db, businessId, {
        quietHoursEnabled,
        quietHoursStartHour: Number(quietHoursStartHour) || 0,
        quietHoursEndHour: Number(quietHoursEndHour) || 0,
        notifyActionNeeded,
        notifyConfirmationRequest,
      });
      setSettings(updated);
      setQuietHoursStartHour(String(updated.quiet_hours_start_hour));
      setQuietHoursEndHour(String(updated.quiet_hours_end_hour));
      setNotificationsSavedAt(updated.updated_at);
    } finally {
      setNotificationsSaving(false);
    }
  }

  async function handleRequestOtp() {
    setAuthBusy(true);
    setAuthMessage(null);
    try {
      const result = await requestOtp(otpEmail);
      if (result.ok) {
        setOtpStage("code");
        setAuthMessage("Check your email for a sign-in code.");
      } else {
        setAuthMessage(result.error);
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleVerifyOtp() {
    setAuthBusy(true);
    setAuthMessage(null);
    try {
      const result = await verifyOtp(otpEmail, otpCode);
      if (result.ok) {
        setOtpStage("email");
        setOtpEmail("");
        setOtpCode("");
        setAuthMessage(null);
      } else {
        setAuthMessage(result.error);
      }
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    setAuthBusy(true);
    try {
      await signOut();
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleRevealRecoveryCode() {
    if (recoveryCode) {
      setRecoveryCodeRevealed((prev) => !prev);
      return;
    }
    const key = await getDeviceEncryptionKey();
    setRecoveryCode(key);
    setRecoveryCodeRevealed(true);
  }

  async function handleExport() {
    if (!businessId) return;
    setExportBusy(true);
    setExportResult(null);
    try {
      const db = await getDb();
      const result = await writeExportFiles(db, businessId);
      setExportResult(`Saved:\n${result.jsonFilePath}\n${result.csvFilePath}`);
    } catch (err) {
      setExportResult(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExportBusy(false);
    }
  }

  function handleDeletePress() {
    Alert.alert(
      "Delete all business data?",
      "This permanently erases every captured event, record, and cloud backup for this business on this device. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete everything",
          style: "destructive",
          onPress: () => {
            handleConfirmedDelete();
          },
        },
      ],
    );
  }

  async function handleConfirmedDelete() {
    setDeleteBusy(true);
    try {
      // Remote first (Vol 4_4's local-first principle still applies: a
      // failure here must never block the local wipe below), then local
      // — the Sprint 10 risk register's "explicitly test that deletion
      // propagates to backup storage, not just the local device."
      const remoteResult = await deleteRemoteAccountData();
      const db = await getDb();
      await deleteAllLocalData(db);
      await load();
      if (remoteResult.attempted && !remoteResult.ok) {
        Alert.alert(
          "Local data cleared",
          `Your cloud backup could not be removed right now (${remoteResult.error}). Try again once you're back online and signed in.`,
        );
      } else {
        Alert.alert("Done", "All local business data has been erased.");
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  if (loadError) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.heading}>Settings</Text>
        <Text style={styles.errorText}>{loadError}</Text>
      </ScrollView>
    );
  }

  if (!settings) {
    return (
      <View style={styles.centeredLoading}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Settings</Text>

      {/* Business Profile — Vol 7_7 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Business profile</Text>
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
          onPress={handleSaveProfile}
          disabled={profileSaving}
        >
          <Text style={styles.buttonText}>
            {profileSaving ? "Saving…" : "Save profile"}
          </Text>
        </Pressable>
        {profileSavedAt && (
          <Text style={styles.savedText}>
            Saved {new Date(profileSavedAt).toLocaleString()}
          </Text>
        )}
      </View>

      {/* Notifications — Vol 7_5, Vol 7_7 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Notifications</Text>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>Quiet hours</Text>
          <Switch
            value={quietHoursEnabled}
            onValueChange={setQuietHoursEnabled}
          />
        </View>
        {quietHoursEnabled && (
          <View style={styles.row}>
            <Text style={styles.label}>From (hour, 0-23)</Text>
            <TextInput
              style={styles.hourInput}
              value={quietHoursStartHour}
              onChangeText={setQuietHoursStartHour}
              keyboardType="number-pad"
            />
            <Text style={styles.label}>To</Text>
            <TextInput
              style={styles.hourInput}
              value={quietHoursEndHour}
              onChangeText={setQuietHoursEndHour}
              keyboardType="number-pad"
            />
          </View>
        )}

        <View style={styles.row}>
          <Text style={styles.rowLabel}>Action needed alerts</Text>
          <Switch
            value={notifyActionNeeded}
            onValueChange={setNotifyActionNeeded}
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Confirmation requests</Text>
          <Switch
            value={notifyConfirmationRequest}
            onValueChange={setNotifyConfirmationRequest}
          />
        </View>

        <Pressable
          style={styles.button}
          onPress={handleSaveNotifications}
          disabled={notificationsSaving}
        >
          <Text style={styles.buttonText}>
            {notificationsSaving ? "Saving…" : "Save notification settings"}
          </Text>
        </Pressable>
        {notificationsSavedAt && (
          <Text style={styles.savedText}>
            Saved {new Date(notificationsSavedAt).toLocaleString()}
          </Text>
        )}
      </View>

      {/* Finance PKA Management — Vol 7_7, read-only in Phase 1 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Finance PKA</Text>
        <Text style={styles.placeholderText}>
          Version {accountingRules.pka_version} (read-only — update management
          is Phase 2).
        </Text>
      </View>

      {/* Diagnostics — Vol 8_6 Section 4: "sync status, last backup time...
          without technical noise." Not a full log viewer -- just enough
          for the owner to self-diagnose "is something wrong." */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Diagnostics</Text>
        {diagnosticsError && (
          <Text style={styles.errorText}>{diagnosticsError}</Text>
        )}
        {diagnostics && (
          <>
            <Text style={styles.placeholderText}>
              {diagnostics.queuedCount === 0
                ? "Everything captured has been processed — nothing waiting."
                : `${diagnostics.queuedCount} item(s) saved and waiting to process` +
                  (diagnostics.oldestQueuedCapturedAt
                    ? ` — oldest since ${new Date(diagnostics.oldestQueuedCapturedAt).toLocaleString()}.`
                    : ".")}
            </Text>
            <Text style={styles.placeholderText}>
              Last backup:{" "}
              {diagnostics.lastBackupAt
                ? new Date(diagnostics.lastBackupAt).toLocaleString()
                : "Never (see Backup recovery code below to prepare for one)."}
            </Text>
            <Text style={styles.placeholderText}>
              {diagnostics.recentErrorCount24h === 0
                ? "No errors in the last 24 hours."
                : `${diagnostics.recentErrorCount24h} error(s) in the last 24 hours.`}
            </Text>
          </>
        )}
      </View>

      {/* Account — Vol 8_1, optional, never a gate */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Account</Text>
        {authLoading ? (
          <ActivityIndicator />
        ) : session ? (
          <>
            <Text style={styles.placeholderText}>
              Signed in as {session.user.email}. Signing in enables encrypted
              cloud backup and lets you remove your cloud data if you ever
              delete this business.
            </Text>
            <Pressable
              style={styles.button}
              onPress={handleSignOut}
              disabled={authBusy}
            >
              <Text style={styles.buttonText}>
                {authBusy ? "Signing out…" : "Sign out"}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.placeholderText}>
              Optional. Your business data stays on this device either way —
              signing in only enables encrypted cloud backup.
            </Text>
            {otpStage === "email" ? (
              <>
                <TextInput
                  style={styles.input}
                  value={otpEmail}
                  onChangeText={setOtpEmail}
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                <Pressable
                  style={styles.button}
                  onPress={handleRequestOtp}
                  disabled={authBusy}
                >
                  <Text style={styles.buttonText}>
                    {authBusy ? "Sending…" : "Send sign-in code"}
                  </Text>
                </Pressable>
              </>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  value={otpCode}
                  onChangeText={setOtpCode}
                  placeholder="6-digit code"
                  keyboardType="number-pad"
                />
                <Pressable
                  style={styles.button}
                  onPress={handleVerifyOtp}
                  disabled={authBusy}
                >
                  <Text style={styles.buttonText}>
                    {authBusy ? "Verifying…" : "Verify code"}
                  </Text>
                </Pressable>
              </>
            )}
            {authMessage && <Text style={styles.savedText}>{authMessage}</Text>}
          </>
        )}
      </View>

      {/* BYOK settings — Sprint 6 close-out (AI Gateway migration). Only
          meaningful once signed in, since personal-scope credentials are
          tied to the caller's Gateway identity — BYOKSettingsCard itself
          also no-ops (renders null) when EXPO_PUBLIC_AI_GATEWAY_URL isn't
          configured, same graceful-degradation pattern as every other
          optional feature on this screen. */}
      {session && <BYOKSettingsCard />}

      {/* Data & Privacy — Vol 7_7 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Backup recovery code</Text>
        <Text style={styles.placeholderText}>
          This device's encryption key doubles as your backup recovery code
          (Phase 1 has no separate passphrase). Save it somewhere safe — if this
          device's secure storage is ever cleared before you've saved it, this
          device's own backups become unrecoverable.
        </Text>
        <Pressable style={styles.button} onPress={handleRevealRecoveryCode}>
          <Text style={styles.buttonText}>
            {recoveryCodeRevealed ? "Hide code" : "Reveal recovery code"}
          </Text>
        </Pressable>
        {recoveryCodeRevealed && recoveryCode && (
          <Text selectable style={styles.recoveryCodeText}>
            {recoveryCode}
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Export your data</Text>
        <Text style={styles.placeholderText}>
          Produces a complete JSON snapshot and a readable CSV of your activity,
          saved to this app's document folder.
        </Text>
        <Pressable
          style={styles.button}
          onPress={handleExport}
          disabled={exportBusy}
        >
          <Text style={styles.buttonText}>
            {exportBusy ? "Exporting…" : "Export my data"}
          </Text>
        </Pressable>
        {exportResult && (
          <Text selectable style={styles.savedText}>
            {exportResult}
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Delete all business data</Text>
        <Text style={styles.placeholderText}>
          Permanently erases every local record and, if signed in, your cloud
          backup too. This cannot be undone.
        </Text>
        <Pressable
          style={[styles.button, styles.dangerButton]}
          onPress={handleDeletePress}
          disabled={deleteBusy}
        >
          <Text style={styles.buttonText}>
            {deleteBusy ? "Deleting…" : "Delete all business data"}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  centeredLoading: { flex: 1, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 24, fontWeight: "600" },
  card: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#f2f2f2",
    gap: 8,
  },
  cardTitle: { fontSize: 16, fontWeight: "600" },
  label: { fontSize: 13, color: "#555" },
  input: {
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  hourInput: {
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    width: 56,
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  rowLabel: { fontSize: 14 },
  button: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  dangerButton: { backgroundColor: "#dc2626" },
  buttonText: { color: "#fff", fontWeight: "600" },
  savedText: { fontSize: 12, color: "#555" },
  recoveryCodeText: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    fontSize: 12,
    backgroundColor: "#fff",
    padding: 8,
    borderRadius: 6,
  },
  errorText: { color: "#dc2626" },
  placeholderText: { fontSize: 14, color: "#555" },
});
