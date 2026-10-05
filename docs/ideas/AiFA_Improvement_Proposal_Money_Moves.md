# AiFA Improvement Proposal — "Money Moves" (Path B CFO Action Feed)

**Status:** Slices 1-4 built (5 Oct 2026) and checked in the sandbox; **owner live test pending on both web and mobile.** Web shipped first (owner decision); mobile built at the owner's 5 Oct request.
**Prepared:** 1 October 2026
**Aligns with:** "One Input. AI Does the Rest." · core chain `… → BIE → FIE → AI CFO Assistant Engine (CAE) → Mobile Business Experience` · Vol 2_4 (CAE) · Vol 0_1 §6 (CFO guidance scope)

---

## 1. The gap (evidence, not assumption)

- AiFA's promise has two halves: **capture** (one input) and **follow-through** (AI does the rest). Phase 5 and the Platform initiative built the first half deeply — ~14 domains, 3 channels, approval chaining.
- The second half — *telling the owner the next money move* — is the **AI CFO Assistant Engine**, a named link in the core architecture chain.
- That engine exists only as `packages/core/src/ai/cfoGuidance.ts`, which reads **Path A** (local mobile SQLite). No live web page reads Path A.
- The live web app (**Path B**) has no CFO engine at all. `BusinessOverviewPage.tsx` shows counts across four tabs (cash, AR, overdue count, contract-alert count) but never says *what to do* or *why*.
- Result: a solo owner must read four tabs and join the dots themselves — the opposite of "AI does the rest".

## 2. The idea

A short, ranked **"Money Moves"** list (max 5) — the few things that will most move this business's cash today, each with a one-line **why** and a jump to the page that fixes it.

| Signal (existing Path B data) | Move surfaced | Rank |
|---|---|---|
| Approved vouchers > cash/bank balance | "Cash short by RMx for approved bills" | Highest |
| AR ageing: invoice past due | "Chase Sunrise Trading (INV-12) — RM800 overdue" (older = higher) | High |
| Contract alert pending | "Review contract — it has expired / is expiring" | High–Med |
| Approval tasks pending > 48h | "3 approvals waiting on you" | Medium |
| Approved, unpaid vouchers (cash covers) | "2 vouchers ready to pay — RMx" | Medium |
| Capture Triage backlog | "4 captures AiFA could not file" | Low–Med |

**Design rules (inherited from `cfoGuidance.ts`):** deterministic (no AI cost, works with no key), explainable (`why` on every item), honest (empty list when nothing needs attention — never manufactured advice), no new RPC, no schema change.

## 3. Why this, why now

- Uses only data AiFA already produces — zero new risk to ledger or schema.
- Closes the loop on Phase 5: every capture eventually becomes either a Move or nothing.
- Natural home for later AI value: once the deterministic feed exists, an optional AI layer can draft the follow-up itself (e.g. a WhatsApp payment reminder via the existing Sprint 28 send path) — "AI does the rest" literally.

## 4. Rollout (small, reviewable slices)

1. **Slice 1 — DONE (1 Oct 2026):** `packages/core/src/ai/cfoActionFeed.ts` (`buildCfoActionFeed`) + `app/src/db/__tests__/cfoActionFeed.test.ts` (9 tests). Pure function; nothing wired to UI yet.
2. **Slice 2 — BUILT (web), awaiting live test:** new **Today** tab on Business Overview (owner chose option B), first and default. `web/src/shell/pages/TodayMoneyMovesTab.tsx` (new) loads 7 existing reads in parallel with `Promise.allSettled` — if one source fails (e.g. no permission for a role), the list still shows and names what could not be checked. Each action has a "Go to …" button. Edits: `BusinessOverviewPage.tsx` (tab + `onNavigate` prop), `AppShell.tsx` (passes navigation). Sandbox checks: web `tsc` clean, ESLint clean, `vite build` succeeds. Vol 12_2 §5.1 amended.
3. **Slice 3 — BUILT, awaiting live test: "Draft reminder" on overdue-invoice moves.** New `packages/core/src/ai/paymentReminder.ts`: deterministic English / Bahasa Melayu reminder text (tone steps up: ≤30 days friendly, 31-60 firm, 60+ final notice), Malaysian phone → `wa.me` normaliser, click-to-chat link builder. Editable text; **"Open WhatsApp" only opens the chat — the owner taps Send** (same rule as Quotation send). No phone on file → WhatsApp asks the owner to pick the contact. Chose templates over an AI call: exact facts, no cost, no key needed, can't invent an amount. `CfoAction` gained an optional `invoice` field (additive).
4. **Slice 4 — BUILT, awaiting live test: mobile.** New shared `packages/core/src/ai/cfoActionFeedLoader.ts` (both platforms use it, so they always agree). Web Today tab switched to it. Mobile: `app/src/components/MoneyMovesCard.tsx` at the top of the Dashboard + `app/src/lib/moneyMovesSources.ts` (mobile's Supabase reads). Mobile needs the owner **signed in** (the data is in the cloud books, not on-device SQLite); signed out it shows a one-line hint. Business picked from the login's active membership; 0 or >1 businesses are stated plainly (no mobile picker yet). No "Go to page" buttons on mobile (those pages are web-only). Reminder uses React Native's built-in `Linking` + `Share` — no new dependencies.
   - **Sandbox checks (5 Oct):** web `tsc` + ESLint clean + `vite build` OK; mobile `tsc` clean (baseline also clean), ESLint 0 errors / 0 warnings on new files; **full mobile Jest suite 192/192 passing (22 suites)**, incl. 21 Money Moves tests.
   - **Known mobile prerequisite:** `app/.env` still points at local dev Supabase (open item from Sept). For mobile to show the same Money Moves as web, it must point at the cloud project — owner decision.

## 5. Decision (resolved 1 Oct 2026: option B — a "Today" tab)

Vol 12_2 §5.1 fixes Business Overview at **exactly four tabs** as a hard rule. Where should Money Moves live?

- **A (recommended):** a compact "Money Moves" card at the top of the existing Snapshot tab — no new tab; Vol 12_2 §5.1 gets a one-line amendment.
- **B:** a fifth "Today" tab — requires formally amending the four-tab rule.
- **C:** its own sidebar item under Overview.

## 6. Other ideas considered (not chosen for now)

- **Cash runway forecast** (weeks of cash left) — valuable, but AP is always RM0 today (vouchers post cash-basis), so a forecast would mislead. Revisit once an AP/accrual concept exists.
- **e-Invoice readiness score** — blocked: the e-Invoice provider is still a simulated stub.
- **Customer self-service statement page** on the aifa.com public surface — good fit, but depends on Platform Sprint 67 (public documents) first.

---

*End of document.*
