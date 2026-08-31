# Sprint 1 — Foundation & Setup

**Duration:** Weeks 1–2
**Architecture references:** Vol 11_0 (Technology Stack Decisions), Vol 7_0 (Mobile Application Architecture), Vol 3_0 §4.1 (Phase 1 PKA reality), Vol 8_1 (Identity & Access Management)

---

## Theme

Nothing here is user-facing. This sprint exists so every later sprint has a repo, a running app shell, a backend, and a place to put governed knowledge, instead of rediscovering these decisions mid-feature.

## Objectives

By the end of this sprint: a blank-but-running mobile app builds and launches on a device/simulator, talks to a real backend project, stores data in an encrypted local database, and the repository contains the first version of the Finance PKA content bundle.

## Task Breakdown

### Mobile/App Shell
- Initialise the mobile project using the chosen framework (Vol 11_0 §2)
- Set up the navigation shell per Vol 7_0 §3: Capture, AI Workspace, Dashboard, Documents, Settings
- Wire basic app-level state/config management
- Get a debug build running on both Android and iOS targets (or the primary target if starting single-platform)

### Backend & Auth
- Provision the backend project (Postgres + auth + storage, Vol 11_0 §5)
- Implement minimal single-user auth (email/OTP) per Vol 8_1 §4 — Phase 1 is single-user, no team roles
- Confirm the app can authenticate and hold a session

### Local Data Layer
- Set up SQLite with SQLCipher (Vol 11_0 §3) and confirm encryption at rest is active, not just configured
- Create the initial (empty) schema migration scaffold, ready for Vol 11_1's tables in Sprint 2
- Set up encrypted local file storage for future documents (Vol 11_1 §5)

### Finance PKA Bundle (Phase 1 form)
- Create the versioned PKA content directory in the repo per Vol 3_0 §4.1 (not signed/distributed — just reviewed files)
- Draft `role_definition.md` v0.1 — AIFA's CFO-assistant tone and scope statement (Vol 1_0 §6, Vol 2_4 §4)
- Draft a minimal `accounting_rules.json` stub covering only the Expense domain (Sprint 3 needs this first)
- Record the PKA version string convention that Vol 11_1 §6 references

### Repo & Tooling
- Repository structure, linting, basic CI (build + lint on push)
- `.env`/config handling for the cloud AI vendor key (Vol 11_0 §4) — no key committed, but the config slot exists

## Definition of Done

- [ ] App builds and launches to the navigation shell on a real device or simulator
- [ ] A test user can sign up/log in against the real backend
- [ ] A row can be written to and read from the encrypted local database
- [ ] The Finance PKA directory exists with a versioned `role_definition.md` and an Expense-only `accounting_rules.json` stub
- [ ] CI runs on push and passes on the empty/shell app

## Dependencies

None — this is the starting sprint.

## Risks

| Risk | Mitigation |
|---|---|
| Framework choice friction (React Native vs. Flutter) discovered late | Vol 11_0 already made this decision; don't re-litigate mid-sprint — note concerns for a future ADR instead |
| Backend provider setup takes longer than expected (billing, project config) | Do this on day 1, not day 10, so it doesn't block Sprint 2 |

## Safe to Carry Over

CI polish and iOS-specific build issues (if Android is the primary pilot platform) can slip into Sprint 2 without blocking anything.

---

*End of Sprint 1.*
