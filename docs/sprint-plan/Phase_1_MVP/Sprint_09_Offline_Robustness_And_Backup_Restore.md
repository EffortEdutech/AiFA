# Sprint 9 — Offline Robustness & Backup/Restore

**Duration:** Weeks 17–18
**Architecture references:** Vol 7_4 (Offline & Synchronisation Experience), Vol 4_4 (Local-First Storage & Synchronisation), Vol 8_4 (Synchronisation & Cloud Services, Phase 1 backup-only)

---

## Theme

Offline capture has worked informally since Sprint 2, but this sprint is where it gets hardened and tested deliberately, and where data actually leaves the device for the first time — as an encrypted backup, not live sync (Phase 1 explicitly excludes multi-device sync, Vol 0_1 §4).

## Objectives

The app behaves correctly through realistic connectivity loss/restore cycles, and an owner's data can be backed up and restored onto a new device login without loss.

## Task Breakdown

### Offline Queueing Hardening
- Audit every capture path (text, photo, manual Sales/Purchase/Banking entry) for correct "queued" behaviour when offline (Vol 7_4 §2)
- Verify queued interpretation tasks resume automatically and correctly on reconnect (Vol 7_4 §4)
- Connectivity state indication in the UI (Vol 7_4 §3) — the owner should never wonder whether something was saved

### Backup (Phase 1: Upload-Only, Vol 0_1 §4)
- Encrypted client-side backup of local data to backend storage (Vol 8_4 §2, Vol 11_0 §5)
- Scheduled/triggered backup (e.g., on app background, or periodically) — no live sync loop
- Backup includes Business Events, Business Data, Financial Data, Business Knowledge Store, and Documents

### Restore Flow
- New device (or reinstalled app) login triggers restore-from-backup
- Verify restored data is byte-for-byte functionally equivalent to the original (same balances, same documents, same event history)

## Definition of Done

- [ ] Capturing an event, killing connectivity mid-interpretation, and restoring connectivity later results in correct final state with no data loss or duplication
- [ ] A full backup completes and is verifiably encrypted before leaving the device
- [ ] A test restore onto a fresh install reproduces an identical dashboard, ledger, and document set to the source device
- [ ] The app never silently loses a captured event under any tested connectivity scenario

## Dependencies

Every prior sprint's capture and data paths — this sprint stress-tests all of them under connectivity failure rather than adding new features.

## Risks

| Risk | Mitigation |
|---|---|
| Edge cases in queue resumption (e.g., app killed mid-queue) are easy to miss | Explicitly test app-kill-and-relaunch mid-queue, not just airplane-mode toggling |
| Backup restore silently drops a field | Build an automated equivalence check (source vs. restored) rather than relying on manual spot-checks |

## Safe to Carry Over

Backup scheduling sophistication (e.g., smart Wi-Fi-only backup) can default to "on every app background" and be refined later.

---

*End of Sprint 9.*
