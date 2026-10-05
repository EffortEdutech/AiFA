# UI Polish (Oct 2026) — conventions and QA record

Branch `ui-polish`. Presentation-only: no backend, RPC, schema or ledger changes, no new production dependencies.

## Owner Console (`web/`)

- Tokens: `web/src/shell/tokens.css`. Global baseline: `web/src/index.css`. Shared kit: `web/src/ui/` (`ui-` CSS namespace, `ui.css`).
- Kit components: Button, Card, DataTable, EmptyState, Field, ConfirmDialog, PageHeader, Skeleton, StatGrid/StatTile, StatusPill, Icon, plus `formatMoney`, `formatDate`, `humanizeStatus`.
- Form controls use `.ui-input`, `.ui-select`, `.ui-textarea` (wrapped in `Field` for labels). Bare `button`/`input` elements are neutral; gold appears only on `.ui-btn--primary`.
- Page pattern: `PageHeader` (+ `TabStrip` as children) → load errors as `aifa-alert aifa-alert--danger role="alert"` → create form in a `Card` → list in `Card flush` + `DataTable` (rows `null` = loading skeleton, `[]` on load error).
- `DataTable` ignores clicks/keys that originate from controls inside a row, so row actions and row selection coexist.
- Legacy classes `.card/.row/.muted/.error/.tabs` remain in `index.css` only for components no live screen renders: `OverviewPage`, `Dashboard`, `CaptureForm`, `SettingsReadOnly`, `DomainSettingsCard`. Restyle `DomainSettingsCard` before wiring it into an Operator surface.

## Disclosures that must stay visible

AP RM0.00 label; SIMULATED e-Invoice (not LHDN MyInvois) and e-Signature banners; Balance Sheet "may not balance" banner; tax-report placeholder note; Maybank2u "unverified" warnings; PCB approximation caveat; read-only device notice; WhatsApp "nothing is sent until you tap Send"; solo/team approval-routing notes.

## Public Site (`web-public/`)

Owner-chosen accent colour is the only per-business style; everything else follows the shared design language.

## QA record (Phase 6)

- `web`: `tsc --noEmit`, `eslint`, `vite build` clean (CSS ≈24 kB, JS ≈797 kB).
- `web-public`: `tsc --noEmit` clean (no ESLint config in that package).
- Contrast (WCAG AA, text tokens on their surfaces): all pairs ≥ 4.5:1 (lowest: warning on warning-bg 4.51, success on success-bg 4.57).
- Labels: every live input/select has a visible label or `aria-label`; three unlabeled Capture resolve selects (payment method, clock type, contract type) fixed.
- Not done in the cloud: visual/browser review of each page, keyboard walk-through, screen-reader pass (needs real data and a browser).
