# AIFA — PKA Runtime Engine Architecture
## Volume 2_1 — Series 2: Core Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines the PKA Runtime Engine (PRE) — the component responsible for installing, validating, and executing governed Finance PKA packages inside AIFA, without ever manufacturing or modifying them.

## 2. Scope

The PRE sits directly below the Finance PKA in the system flow (Vol 2_0, Section 2) and directly above the Knowledge Retrieval & Context Engine. It is the enforcement point for the boundary: *Knowledge Factory manufactures; AIFA only executes.*

## 3. Responsibilities

| Responsibility | Description |
|---|---|
| Package installation | Load a signed, versioned Finance PKA package onto the device |
| Integrity validation | Verify signature, version, and structural integrity before activation |
| Runtime execution | Expose the PKA's Knowledge Objects, rules, workflows, and templates to KRCE on request |
| Version management | Support installing PKA updates without corrupting in-flight business data |
| Isolation | Prevent business data or client context from ever being written into the shared PKA package |
| Multi-PKA orchestration | Support additional installed PKAs (e.g., Industry Finance PKA extensions, Vol 10_2) alongside the base Finance PKA |

## 4. What the PRE Must Never Do

- Author or edit Knowledge Objects, rules, or templates within a PKA
- Merge business-specific data into the PKA package on disk
- Allow an AI model or any application code direct, unmediated access to the full PKA — all access is brokered through KRCE
- Activate a package that fails signature or integrity validation

## 5. Execution Flow

```text
Installed Finance PKA (validated, signed)
        ↓
PRE loads package metadata + indexes Knowledge Objects
        ↓
KRCE issues a scoped retrieval request
        ↓
PRE resolves the request against the installed package(s)
        ↓
Relevant Knowledge Objects returned to KRCE (not the whole package)
```

## 6. Multi-Package Model

A device may have more than one PKA installed at once: the base Finance PKA plus zero or more Industry Finance PKA extensions. The PRE resolves retrieval requests across all installed, compatible packages and returns a merged, still-minimal result set to KRCE — it does not expose package boundaries to the AI model.

## 7. Relationships to Other Volumes

- Vol 3_0 (Finance PKA Architecture) defines what a package contains.
- Vol 3_1 (KRCE) is the PRE's primary consumer.
- Vol 8_5 (Finance PKA Distribution & Update Architecture) defines how packages reach the PRE.
- Vol 10_2 (Industry Finance PKA Architecture) defines the extension packages referenced in Section 6.

---

*End of Volume 2_1.*
