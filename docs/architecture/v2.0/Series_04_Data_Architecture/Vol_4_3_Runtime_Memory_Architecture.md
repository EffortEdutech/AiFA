# AIFA — Runtime Memory Architecture
## Volume 4_3 — Series 4: Data Architecture — Version 2.0

**Status:** Complete

---

## 1. Purpose

This volume defines Runtime Memory: the temporary, task- and session-bound context layer that supports an in-progress conversation or workflow without becoming permanent knowledge.

## 2. Characteristics

| Property | Value |
|---|---|
| Persistence | Temporary |
| Scope | Task-specific, session-bound |
| Lifetime | Expires per policy (see Section 4) |
| Promotion path | Only via BKEE validation (Vol 4_2) into Business Knowledge, or discarded |

## 3. What Lives in Runtime Memory

- The current conversation's turn history
- Intermediate clarification exchanges (e.g., "did you mean this supplier or that one?")
- In-progress multi-step workflow state (e.g., a partially completed expense capture)
- Recently retrieved PCB content for the active task

## 4. Expiry Policy

Runtime Memory expires when: the task or conversation concludes, a configured idle timeout elapses, or the app session ends — whichever comes first. Expiry is a deliberate design choice: it prevents transient, unvalidated context from silently becoming a source of truth.

## 5. Boundary with Permanent Knowledge

```text
Runtime Memory (temporary)
        ↓ (only via governed validation)
Finance PKA (via Knowledge Factory) — professional knowledge
        or
Business Knowledge Store (via BKEE) — organisation-specific knowledge
```

Nothing in Runtime Memory is treated as authoritative once it expires; if a fact needs to persist, it must be captured as a Business Event, confirmed Business Data, or validated Business Knowledge before the session ends.

## 6. Security Considerations

Because Runtime Memory may transiently hold sensitive business context assembled for a PCB, it is held in the same encrypted local storage boundary as other business data (Vol 8_2) and is never transmitted beyond what the current PCB requires.

## 7. Relationships to Other Volumes

- Vol 4_2 (Business Knowledge Store) is the only promotion path out of Runtime Memory.
- Vol 3_1 (KRCE) reads and writes Runtime Memory during PCB assembly.
- Vol 5_3 (AI Context Management) manages Runtime Memory across a multi-turn AI conversation.
- Vol 8_2 (Security & Data Protection Architecture) defines the storage protections applied here.

---

*End of Volume 4_3.*
