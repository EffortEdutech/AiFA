import { CameraView, useCameraPermissions } from "expo-camera";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

/**
 * Camera capture UI — Vol 7_1 §2 photo mode. Captures at reduced JPEG
 * quality (0.5) as the Phase 1 "reasonable compression" measure flagged in
 * Sprint 5's risk register, avoiding a separate image-manipulation
 * dependency (AGENTS.md restricts new production deps without approval) —
 * `takePictureAsync`'s own `quality` option is sufficient for Phase 1.
 *
 * IMPORTANT: this component requires a real camera and cannot be exercised
 * in the sandboxed environment this project was built in (no camera
 * hardware). It is code-complete and type-checked but UNTESTED on a real
 * device — verify on your own phone before relying on it.
 */
export function PhotoCapture({
  onCaptured,
  onCancel,
}: {
  onCaptured: (base64: string, mimeType: string) => void;
  onCancel: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  if (!permission) {
    return <ActivityIndicator style={styles.centered} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>
          AIFA needs camera access to capture receipts and invoices.
        </Text>
        <Pressable
          style={styles.button}
          onPress={requestPermission}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>Grant camera access</Text>
        </Pressable>
        <Pressable
          style={styles.linkButton}
          onPress={onCancel}
          accessibilityRole="button"
        >
          <Text style={styles.linkButtonText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  async function handleCapture() {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    setCaptureError(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.5,
      });
      if (photo?.base64) {
        onCaptured(photo.base64, "image/jpeg");
      } else {
        // Sprint 11 fresh-eyes review of Sprint 5's capture failure
        // handling: takePictureAsync resolving with no base64 at all
        // (distinct from it throwing, handled below) previously did
        // nothing visible -- the owner would just see the shutter
        // "fire" with no result and no explanation.
        setCaptureError("Couldn't capture that photo. Try again.");
      }
    } catch (err) {
      // A real, previously-unhandled gap: any camera-hardware-level
      // failure (storage full, permission revoked mid-session, etc.)
      // threw straight past this component with no owner-facing error
      // state at all -- silently doing nothing. This is a genuinely
      // different failure mode from Vol 7_1 §5.1's "extraction fails"
      // cases (which happen further downstream, after a photo was
      // successfully captured) -- not tracked in app_error_log (Vol 8_6
      // §2's Observability Domains table doesn't include camera hardware),
      // just surfaced inline so the owner can immediately retry.
      setCaptureError(
        err instanceof Error
          ? err.message
          : "Couldn't take the photo. Try again.",
      );
    } finally {
      setCapturing(false);
    }
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />
      {captureError && (
        <Text style={styles.captureErrorText}>{captureError}</Text>
      )}
      <View style={styles.controls}>
        <Pressable
          style={styles.linkButton}
          onPress={onCancel}
          accessibilityRole="button"
        >
          <Text style={styles.linkButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={styles.captureButton}
          onPress={handleCapture}
          disabled={capturing}
          accessibilityRole="button"
          accessibilityLabel="Take photo"
        >
          {capturing ? <ActivityIndicator color="#fff" /> : null}
        </Pressable>
        <View style={styles.linkButton} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center" },
  container: { flex: 1, backgroundColor: "#000" },
  camera: { flex: 1 },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 20,
    backgroundColor: "#000",
  },
  captureButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 4,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  linkButton: { minWidth: 60 },
  linkButtonText: { color: "#fff", fontSize: 15 },
  captureErrorText: {
    color: "#ff8a80",
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  permissionContainer: {
    flex: 1,
    padding: 24,
    gap: 12,
    justifyContent: "center",
  },
  permissionText: { fontSize: 15, color: "#333", textAlign: "center" },
  button: {
    backgroundColor: "#222",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
