import {
  getDocumentBlob,
  listDocumentLibrary,
  type DocumentLibraryItem,
} from "@aifa/core/db/documentRepository";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { getDb, getLocalBusinessId } from "@/db/client";

const EXTRACTION_LABEL: Record<
  DocumentLibraryItem["document"]["extraction_status"],
  string
> = {
  not_attempted: "Waiting to process",
  partial: "Partly read — check details",
  complete: "Read successfully",
  failed: "Couldn't read automatically",
};

/**
 * Document & Receipt Experience — Vol 7_6. Sprint 5 scope: basic browsable
 * library (Vol 7_6 §3) — functional access to every captured document,
 * newest first, with a thumbnail and its linked event's context. Search/
 * filtering is explicitly safe to carry over per the Sprint 5 plan.
 *
 * Reads only local, SQLCipher-encrypted data (the same database Capture
 * and Dashboard use) — documents remain viewable fully offline (Sprint 5
 * Definition of Done).
 */
export default function DocumentsScreen() {
  const [items, setItems] = useState<DocumentLibraryItem[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const businessId = await getLocalBusinessId();
      const db = await getDb();
      const library = await listDocumentLibrary(db, businessId);
      setItems(library);

      const thumbs: Record<string, string> = {};
      for (const item of library) {
        const blob = await getDocumentBlob(db, item.document.file_ref);
        if (blob) {
          thumbs[item.document.id] =
            `data:${blob.mime_type};base64,${blob.base64_data}`;
        }
      }
      setThumbnails(thumbs);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load documents.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
    >
      <Text style={styles.heading}>Documents</Text>

      {error && <Text style={styles.error}>{error}</Text>}
      {loading && <ActivityIndicator style={styles.loading} />}

      {!loading && items.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            No receipts or invoices captured yet. Take a photo from the Capture
            tab to add one.
          </Text>
        </View>
      )}

      {items.map((item) => (
        <View key={item.document.id} style={styles.row}>
          {thumbnails[item.document.id] ? (
            <Image
              source={{ uri: thumbnails[item.document.id] }}
              style={styles.thumbnail}
            />
          ) : (
            <View style={[styles.thumbnail, styles.thumbnailPlaceholder]} />
          )}
          <View style={styles.rowInfo}>
            <Text style={styles.rowTitle}>
              {item.counterpartyName || "Unlabelled document"}
            </Text>
            <Text style={styles.rowMeta}>
              {item.amount != null && item.currency
                ? `${item.currency} ${item.amount.toFixed(2)} · `
                : ""}
              {new Date(item.eventCapturedAt).toLocaleDateString()}
            </Text>
            <Text style={styles.rowStatus}>
              {EXTRACTION_LABEL[item.document.extraction_status]}
            </Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  heading: { fontSize: 24, fontWeight: "600" },
  error: { color: "#c0392b", fontSize: 13 },
  loading: { marginTop: 24 },
  emptyState: { padding: 16, borderRadius: 12, backgroundColor: "#f2f2f2" },
  emptyText: { fontSize: 14, color: "#555" },
  row: {
    flexDirection: "row",
    gap: 12,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#f8f8f8",
    alignItems: "center",
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: "#eee",
  },
  thumbnailPlaceholder: {},
  rowInfo: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: "600" },
  rowMeta: { fontSize: 12, color: "#777" },
  rowStatus: { fontSize: 12, color: "#8a5a00" },
});
