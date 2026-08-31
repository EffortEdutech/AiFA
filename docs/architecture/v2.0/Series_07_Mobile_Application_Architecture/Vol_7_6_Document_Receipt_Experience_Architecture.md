# AIFA — Document & Receipt Experience Architecture
## Volume 7_6 — Series 7: Mobile Application Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines how receipts, invoices, and other evidentiary documents are captured, stored, and linked to Business Events.

## 2. Document Lifecycle

```text
Photo/PDF captured or imported
        ↓
Stored locally (encrypted) as a document asset
        ↓
Linked to the Business Event it evidences (Vol 4_0)
        ↓
Available for review, export, or accountant handoff
```

## 3. Document Library View

Documents are browsable independent of the transaction flow (e.g., "show me all receipts from this supplier") while always remaining linked to their originating Business Event for traceability, consistent with Vol 1_2 Section 5.

## 4. Retention and Export

Documents remain available locally for as long as the business retains them, and are included in encrypted backups (Vol 4_4, Vol 8_2). Owners can export a document set (e.g., for a specific period or supplier) for accountant or auditor handoff.

## 5. Extraction Confidence

Where OCR or vision extraction has low confidence in reading a document (e.g., a blurry receipt), the app flags the specific unclear field for owner confirmation rather than silently guessing — consistent with Vol 1_4 Section 7.

## 6. Sprint 5 Concrete Implementation

The "stored locally (encrypted)" step in Section 2 is implemented by storing the image as a base64 BLOB inside the app's SQLCipher-encrypted SQLite database (a `document_blobs` table), not as a loose encrypted file on the filesystem. This reuses the whole-database at-rest encryption op-sqlite/SQLCipher already provides (Vol 11_0 §3) instead of adding a new file-encryption dependency — see the migration 5 comment in `app/src/db/migrations.ts` for the full reasoning and the condition (image volume/size becoming impractical for SQLite) that would trigger revisiting it.

Photo capture always saves the Document row immediately, before any extraction is attempted — the photo itself is never lost even if vision extraction fails entirely, partially succeeds, or the device is offline (Section 5, Vol 7_1 §5.1).

## 7. Relationships to Other Volumes

- Vol 7_1 (Business Event Capture Architecture) is the primary capture path feeding this library.
- Vol 4_0 (Business Data Architecture) holds the Business Event each document is linked to.
- Vol 8_2 (Security & Data Protection Architecture) governs document encryption and retention security.

---

*End of Volume 7_6.*
