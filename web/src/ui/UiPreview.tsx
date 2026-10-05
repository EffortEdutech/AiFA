/**
 * Dev-only gallery of the ui kit (UI polish Phase 1): every component and
 * every state in one page. Open `http://localhost:<port>/?ui-preview` while
 * running `npm run dev`. main.tsx loads this behind `import.meta.env.DEV`,
 * so it is never part of a production build.
 */
import { useState } from "react";

import {
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  formatDate,
  formatMoney,
  ICON_NAMES,
  Icon,
  PageHeader,
  SkeletonLines,
  StatGrid,
  StatTile,
  StatusPill,
  type Column,
} from "./index";

interface InvoiceRow {
  id: string;
  no: string;
  customer: string;
  status: string;
  due: string;
  amount: number;
}

const ROWS: InvoiceRow[] = [
  { id: "1", no: "INV-0012", customer: "Sunrise Trading Sdn Bhd", status: "overdue", due: "2026-09-12", amount: 8000 },
  { id: "2", no: "INV-0013", customer: "Kopi Kita Enterprise", status: "sent", due: "2026-10-20", amount: 1250.5 },
  { id: "3", no: "INV-0014", customer: "Mawar Catering", status: "paid", due: "2026-10-01", amount: 640 },
  { id: "4", no: "INV-0015", customer: "Bina Jaya Contractors", status: "draft", due: "2026-11-02", amount: 15420 },
  { id: "5", no: "INV-0016", customer: "Teknik Maju", status: "converted_to_invoice", due: "2026-10-30", amount: 980.75 },
];

const COLUMNS: Column<InvoiceRow>[] = [
  { key: "no", header: "Invoice", render: (r) => <strong>{r.no}</strong> },
  { key: "customer", header: "Customer", render: (r) => r.customer },
  { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} /> },
  { key: "due", header: "Due", render: (r) => formatDate(r.due) },
  { key: "amount", header: "Amount", numeric: true, render: (r) => formatMoney(r.amount) },
];

export default function UiPreview(): JSX.Element {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="ui-page" style={{ padding: 24, margin: "0 auto" }}>
      <PageHeader
        title="Invoices"
        description="Everything you have billed, what is still owed, and what is overdue."
        actions={
          <>
            <Button variant="secondary" icon="search">
              Filter
            </Button>
            <Button variant="primary" icon="plus">
              New invoice
            </Button>
          </>
        }
      />

      <StatGrid>
        <StatTile label="Cash position" value={formatMoney(24180.4)} />
        <StatTile label="Accounts receivable" value={formatMoney(10270.5)} tone="info" />
        <StatTile label="Overdue" value={formatMoney(8000)} tone="danger" hint="1 invoice past due" />
        <StatTile label="Pending approvals" value={null} />
      </StatGrid>

      <Card title="Invoice list" description="Click a row to open it." flush actions={<Button size="sm">Export</Button>}>
        <DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} caption="Invoices" onRowClick={() => undefined} />
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <Card title="Loading state" flush>
          <DataTable columns={COLUMNS} rows={null} rowKey={(r) => r.id} caption="Loading invoices" skeletonRows={3} />
        </Card>
        <Card title="Error state">
          <DataTable columns={COLUMNS} rows={[]} rowKey={(r) => r.id} caption="Invoices" error="Could not load invoices. Check your connection and try again." />
        </Card>
        <Card title="Empty state">
          <EmptyState
            icon="receipt"
            title="No invoices yet"
            description="Create your first invoice, or forward one to AiFA and it will be filed for you."
            action={<Button variant="primary">New invoice</Button>}
          />
        </Card>
        <Card title="Skeleton text">
          <SkeletonLines lines={4} />
        </Card>
      </div>

      <Card title="New party">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          <Field label="Display name" required hint="As it should appear on documents.">
            {(p) => <input className="ui-input" placeholder="Sunrise Trading" {...p} />}
          </Field>
          <Field label="Contact email" error="Enter a valid email address.">
            {(p) => <input className="ui-input" defaultValue="not-an-email" {...p} />}
          </Field>
          <Field label="Type">
            {(p) => (
              <select className="ui-select" {...p}>
                <option>Customer</option>
                <option>Supplier</option>
              </select>
            )}
          </Field>
          <Field label="Notes">{(p) => <textarea className="ui-textarea" rows={2} {...p} />}</Field>
        </div>
        <div className="ui-page-actions" style={{ marginTop: 16 }}>
          <Button variant="primary">Create party</Button>
          <Button>Cancel</Button>
          <Button variant="ghost">Learn more</Button>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            Delete…
          </Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Card>

      <Card title="Status pills">
        <div className="ui-page-actions">
          {["draft", "sent", "pending_approval", "paid", "overdue", "rejected", "expired", "something_new"].map((s) => (
            <StatusPill key={s} status={s} />
          ))}
        </div>
      </Card>

      <Card title="Icons">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {ICON_NAMES.map((name) => (
            <div key={name} style={{ display: "grid", justifyItems: "center", gap: 4, width: 84, fontSize: 11, color: "var(--aifa-text-muted)" }}>
              <Icon name={name} size={22} />
              {name}
            </div>
          ))}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        tone="danger"
        title="Delete this party?"
        message="This removes the party from your lists. Past invoices keep their details."
        confirmLabel="Delete party"
        busy={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setBusy(true);
          window.setTimeout(() => {
            setBusy(false);
            setConfirmOpen(false);
          }, 800);
        }}
      />
    </div>
  );
}
