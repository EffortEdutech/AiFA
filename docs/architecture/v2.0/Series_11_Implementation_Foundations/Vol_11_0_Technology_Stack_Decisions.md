# AIFA — Technology Stack Decisions
## Volume 11_0 — Series 11: Implementation Foundations — Version 2.0

**Status:** Complete
**Applies:** Vol 0_1 (MVP & Phased Delivery Roadmap) — this volume makes Phase 1 concrete.
**Note:** Every other volume in this set is deliberately technology-neutral. This volume is deliberately not — sprint planning needs real tools, and neutrality at this stage just hides decisions instead of making them.

---

## 1. Purpose

This volume names specific technology choices for Phase 1 (MVP), with the reasoning behind each, so the sprint plan has something concrete to build against. These are decisions to revisit, not commandments — each entry states what would trigger a reconsideration.

## 2. Mobile Application

| Decision | Choice | Reasoning | Revisit If |
|---|---|---|---|
| Framework | Cross-platform (React Native or Flutter) | One codebase for Android + iOS matches Vol 1_3's "Android and iOS" direction without doubling MVP build cost | Platform-specific performance/capability needs emerge that a cross-platform framework can't meet |
| State/offline data layer | Local-first reactive database (e.g., WatermelonDB, or a lighter SQLite wrapper) | Needs to support offline reads/writes and later sync without a rewrite | Sync complexity outgrows the chosen library's model |

## 3. Local Storage & Encryption

| Decision | Choice | Reasoning | Revisit If |
|---|---|---|---|
| Local database | SQLite with SQLCipher (encryption at rest) | Mature, well-understood, satisfies Vol 8_2's local encryption requirement without custom crypto | Data model outgrows relational storage (unlikely at MVP scale) |
| Document storage | Encrypted local file storage for receipt/invoice images, referenced by ID from the database | Keeps large binary content out of the relational store | N/A for Phase 1 |

## 4. AI Model Strategy (Phase 1)

| Decision | Choice | Reasoning | Revisit If |
|---|---|---|---|
| Reasoning model | A single cloud-hosted frontier model accessed via API (model choice is a build-time config, not hardcoded — per Vol 1_4's model-independence principle) | Phase 1 explicitly does not attempt on-device advisory reasoning (Vol 0_1, Section 3.1) — cloud quality is required to make the "one input" promise trustworthy | Cost-per-event or latency becomes a real constraint at scale, or on-device model quality closes the gap |
| Vision/OCR | The same model's vision capability (single-vendor call) rather than a separate OCR pipeline, unless accuracy testing shows a dedicated OCR service does meaningfully better on receipts | Reduces integration surface for MVP | Receipt-reading accuracy in real testing falls below an acceptable bar |
| Prompt/rule storage | The Finance PKA content (Vol 3_0, Phase 1 form) lives as versioned Markdown/JSON files in the app's own repository, loaded at build or app-start time | Matches the Phase 1 simplification in Vol 0_1 Section 3.2 — no separate distribution service yet | A second consumer product or an external content team needs independent PKA versioning |

## 5. Backend Services (Phase 1)

| Decision | Choice | Reasoning | Revisit If |
|---|---|---|---|
| Backend-as-a-service | A managed Postgres + auth + storage platform (e.g., Supabase) | Minimises backend build time for backup, single-user auth, and encrypted blob storage; Postgres gives a credible upgrade path later | Custom backend requirements (e.g., specific compliance hosting) emerge |
| Backup model | Encrypted client-side blobs uploaded to backend storage, restorable to a new device login | Matches Vol 8_2/8_4's "backup, not a second system of record" model | Multi-device *live* sync (not just backup/restore) becomes a Phase 1 requirement |
| Authentication | Backend-provided email/OTP or social auth, single user per business account | Matches Vol 8_1's Phase 1 scope (single-user; team roles are Phase 2) | Team access requests arrive from real users |

## 6. What Is Explicitly Not Chosen for Phase 1

- No dedicated local AI model runtime (Phase 2, per Vol 0_1 Section 3.1)
- No package signing infrastructure for the Finance PKA (Phase 2, per Vol 0_1 Section 3.2)
- No plugin/extension runtime (Phase 3, Series 9)
- No multi-tenant data model (Phase 3, Series 10)
- No dedicated observability platform beyond basic crash reporting and API error logging (Phase 2 for full Vol 8_6 scope)

## 7. Relationships to Other Volumes

- Vol 0_1 (MVP & Phased Delivery Roadmap) is the scope authority this volume implements concretely.
- Vol 11_1 (MVP Data Schema) defines the schema that runs on the database chosen here.
- Vol 3_0 (Finance PKA Architecture) and Vol 5_1 (AI Runtime Architecture) are the architecture volumes this one makes concrete for Phase 1.

---

*End of Volume 11_0.*
