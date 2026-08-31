# Sprint 5 — Photo Capture, OCR/Vision & Documents

**Duration:** Weeks 9–10
**Architecture references:** Vol 7_1 §5.1 (capture failure handling), Vol 7_6 (Document & Receipt Experience), Vol 11_1 §5 (Document schema)

---

## Theme

Text capture proved the pipeline works; photo capture is what actually delivers "One Input" for the receipt-in-hand moment most owners will use daily. This sprint is also the first real test of the vision-extraction accuracy risk flagged in the Overview.

## Objectives

An owner can photograph a receipt and have it become a correctly (or honestly-imperfectly) interpreted expense, with the photo retained as evidence.

## Task Breakdown

### Document Storage
- Implement the `Document` table per Vol 11_1 §5
- Encrypted local storage for receipt/invoice images (Vol 11_0 §3)
- Link every document to its `BusinessEvent`

### Photo Capture Flow
- Camera capture UI (Vol 7_1 §2, photo mode)
- Send captured image to the cloud model's vision capability (Vol 11_0 §4) as part of PCB assembly
- Populate `BusinessData` fields from extraction results, same downstream pipeline as Sprint 3 (classification, confidence thresholds all reused, not rebuilt)

### Failure Handling (concrete, per Vol 7_1 §5.1)
- OCR fails entirely → show the photo + Sprint 2's blank quick-entry form
- OCR partially succeeds → pre-fill readable fields, highlight only the missing ones
- No connectivity during capture → store locally with "queued" state (this exercises the queueing behaviour that Sprint 9 will harden further)

### Document Library
- Basic browsable document list (Vol 7_6 §3) — not the full library UX polish, just functional access to captured documents

## Definition of Done

- [ ] Photo capture produces a correctly linked `Document` + `BusinessEvent` + `BusinessData` chain
- [ ] All three failure modes in Vol 7_1 §5.1 are tested with real bad inputs (blurry photo, partially unreadable receipt, airplane mode), not just happy-path photos
- [ ] Vision extraction accuracy is measured against a set of real (not synthetic) receipts — record the actual accuracy number, don't assume it's fine
- [ ] Documents remain viewable offline

## Dependencies

Sprint 3's classification pipeline (reused, not rebuilt) and Sprint 2's quick-entry fallback form.

## Risks

| Risk | Mitigation |
|---|---|
| Real-world receipt accuracy is meaningfully worse than clean test images | This is exactly why the Overview flags it — test with real, messy, crumpled, faded receipts this sprint, not stock photos |
| Large image files bloat local storage/backup size | Apply reasonable compression before storage; don't defer this to a later "performance sprint" that may not come |

## Safe to Carry Over

Document library search/filtering can slip; basic browse cannot (it's needed to verify documents are actually stored correctly).

---

*End of Sprint 5.*
