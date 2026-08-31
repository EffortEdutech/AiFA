# Sprint 10 — Security, Settings & Data Rights

**Duration:** Weeks 19–20
**Architecture references:** Vol 8_2 (Security & Data Protection), Vol 7_7 (Settings & Business Configuration, Phase 1 basic), Vol 8_1 (Identity & Access Management)

---

## Theme

Everything built so far has assumed reasonable security hygiene; this sprint verifies and completes it deliberately, and gives the owner the configuration surface and data rights they need before real people trust this app with their financial records.

## Objectives

A security review confirms encryption is correctly applied everywhere it should be; the owner has a working Settings surface and can export or request deletion of their data.

## Task Breakdown

### Security Hardening & Review
- Audit local storage encryption (Vol 8_2 §2) — confirm SQLCipher and document encryption are correctly configured, not just present
- Audit transmission security for backup and AI calls (Vol 8_2 §2)
- Confirm sensitivity classification is respected in PCB construction (nothing over-shares in the minimal PCB, per Vol 3_1 §6 and Vol 8_2 §3)
- Basic auth hardening: session expiry, secure token storage

### Settings & Business Configuration (Phase 1 Basic, Vol 7_7)
- Business Profile screen (name, industry — industry field exists now even though Industry PKAs are Phase 3, so it's ready later)
- Notification preferences, including the full quiet-hours control deferred from Sprint 8
- Finance PKA version display (read-only — Vol 3_0 §4.1, no update mechanism yet, that's Phase 2's Vol 8_5)
- No autonomy-level toggle yet (Phase 2 per Vol 0_1 §4) — Phase 1 always uses the fixed confirm/correct thresholds from Sprint 3

### Data Rights (Vol 8_2 §5)
- Data export (a readable export of Business Events/Financial Data for the owner or their accountant)
- Account/business deletion flow — treated as a full lifecycle action, not selective retroactive editing, consistent with Business Event immutability

## Definition of Done

- [ ] A security pass confirms encryption at rest and in transit across every data path built so far
- [ ] Settings screen is functional for business profile, notifications, and PKA version display
- [ ] Data export produces a complete, readable record of the business's data
- [ ] Deletion flow removes the business's data per the defined lifecycle, verified by testing

## Dependencies

All prior sprints' data paths (this sprint audits and completes them, rather than adding new capture features).

## Risks

| Risk | Mitigation |
|---|---|
| Security issues found late are expensive to fix | This sprint exists precisely to catch them before pilot users are involved (Sprint 12) |
| Deletion flow interacting badly with backup (deleted locally but still in backup) | Explicitly test that deletion propagates to backup storage, not just the local device |

## Safe to Carry Over

Export format polish (e.g., accountant-friendly formatting) can be basic (CSV/JSON) this sprint and improved later.

---

*End of Sprint 10.*
