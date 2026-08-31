# AIFA — Plugin Runtime Architecture
## Volume 9_2 — Series 9: Developer & Extension Architecture — Version 2.0

**Status:** Complete (reconstructed — no document body existed in the source conversation record; drafted fresh for this Version 2.0 set)

---

## 1. Purpose

This volume defines how an installed extension (built against the SDK, Vol 9_1) actually executes on-device, and how it is sandboxed from the rest of AIFA.

## 2. Sandboxing Principle

Every extension runs in an isolated execution context with only the permissions it declared and the business approved (Vol 9_1, Section 4). A misbehaving or malicious extension cannot read another extension's data, cannot escalate its own permissions, and cannot reach the Finance PKA or raw AI model access.

## 3. Runtime Flow

```text
Business Event or scheduled trigger occurs
        ↓
Plugin Runtime checks which installed extensions are subscribed and authorised
        ↓
Extension executes in its sandbox with only its declared, approved data scope
        ↓
Extension output (report, workflow step, notification) returned to the calling surface
        ↓
Runtime validates output conforms to declared output type before display
```

## 4. Resource and Stability Controls

The Plugin Runtime enforces execution time limits and resource caps per extension invocation, so a poorly written or unresponsive extension cannot degrade the core app experience (capture, dashboard, AI Workspace remain unaffected).

## 5. Update and Removal

Extensions can be updated or removed independently of the core app and the Finance PKA; removing an extension does not affect any Business Events or Financial Data already recorded — only the extension's own generated artefacts (e.g., a custom report) become unavailable.

## 6. Relationships to Other Volumes

- Vol 9_1 (Extension SDK Architecture) defines what runs inside this runtime.
- Vol 9_5 (Testing & Validation Architecture) defines the quality gate before an extension reaches this runtime.
- Vol 2_1 (PKA Runtime Engine) is a structurally analogous but separate execution boundary — the Plugin Runtime never has PRE-level access to the Finance PKA.

---

*End of Volume 9_2.*
