# AIFA — Extension SDK Architecture
## Volume 9_1 — Series 9: Developer & Extension Architecture — Version 2.0

**Status:** Complete (reconstructed — no document body existed in the source conversation record; drafted fresh for this Version 2.0 set)

---

## 1. Purpose

This volume defines what a third-party developer builds against when creating an AIFA extension: the SDK's scope, capabilities, and hard limits.

## 2. SDK Capability Surface

| Capability | Description |
|---|---|
| Business Event subscription | React to new Business Events of a declared type/category |
| Read access to scoped Business/Financial Data | Read-only, scoped to what the business has explicitly authorised for that extension |
| Workflow registration | Define a custom multi-step workflow triggered by an event or schedule |
| Custom report/template rendering | Produce a formatted output from Financial Data |
| Approved external calls | Make outbound calls only to endpoints declared and approved at install time |

## 3. What the SDK Does Not Expose

- Direct access to the Finance PKA package contents (Vol 3_0)
- Direct, unmediated calls to the AI model outside the governed PCB flow (Vol 3_1)
- Write access to Financial Data's core ledger (only the BIE, Vol 2_2, writes there)
- Cross-business data access

## 4. Permission Model

Every extension declares, at manifest/install time, exactly which Business Event types, data scopes, and external endpoints it needs. The owner approves this declared scope explicitly (surfaced via Vol 7_7 Settings) before the extension activates — no silent scope expansion after install.

## 5. Developer Experience Principle

The SDK is designed so that a competent developer can build a useful extension (e.g., a custom industry report) without needing to understand or touch the internals of the Bookkeeping or Financial Intelligence Engines — those remain black boxes accessed only through their published, stable interfaces.

## 6. Relationships to Other Volumes

- Vol 9_0 (Developer & Extension Architecture) states the philosophy this SDK implements.
- Vol 9_2 (Plugin Runtime Architecture) is where SDK-built extensions actually execute.
- Vol 8_3 (Integration & API Architecture) governs the "approved external calls" capability.

---

*End of Volume 9_1.*
