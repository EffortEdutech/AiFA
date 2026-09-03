-- ==============================================================
-- AIFA backend schema — Sprint 28 (Vol 13_0 §4 Module A: Invois &
-- Quotation, §4.1 WhatsApp send). First real exercise of Sprint 25's
-- ApprovalTask engine against real domain data (quotations), and the
-- first module built on the full Sprint 21-27 foundation.
--
-- SCOPE NOTES (disclosed):
--
-- 1. DocumentHeader.business_event_id (Vol 13_0 §3.2) is omitted.
--    Like `ledger_entry` before Sprint 26, `BusinessEvent` (Vol 4_0)
--    has no real server-side table — it exists only as an encrypted
--    sync_envelopes payload shape under the local-first model. There
--    is nothing server-side for this column to reference. Sprint
--    25/26's own convention (captured_by_membership_id) is used for
--    capture attribution instead, same as approval_tasks and parties.
--
-- 2. DocumentHeader.created_by (Vol 13_0 §3.2, "ai" | party/user id)
--    is likewise replaced by captured_by_membership_id, for the same
--    reason approval_tasks uses it rather than a free-form string —
--    a real FK is more useful and auditable than a tagged string.
--
-- 3. Invoice.delivery_order_id (Vol 13_0 §4) is included as a plain
--    nullable uuid column with NO foreign key yet — `DeliveryOrder`
--    doesn't exist until Sprint 31 (Module D). Same disclosed pattern
--    Sprint 26 used for bank_statement_lines.matched_ledger_entry_id.
--
-- 4. Quotation.status deliberately matches Vol 13_0 §4's literal enum
--    (draft | sent | accepted | rejected | expired |
--    converted_to_invoice) with no invented "approved" value. The
--    "internally approved, ready to send" state lives on the linked
--    ApprovalTask row instead (subject_type='quotation'), which is
--    exactly what Vol 13_0 §3.3 designed ApprovalTask to be: the one
--    shared gate every module reuses, not a status value duplicated
--    into each subject table. build_whatsapp_quotation_link checks
--    the ApprovalTask's status directly rather than a mirrored
--    quotation.status value.
--
--    A quotation's own `status = 'rejected'` is used for BOTH "the
--    internal approver declined to send this" (via the trigger below)
--    and "the customer declined the quote" (via
--    mark_quotation_rejected) — Vol 13_0's literal enum doesn't
--    distinguish the two, and this migration doesn't invent a new
--    status value to split them. Disclosed as a Phase 1 simplification,
--    not a silent conflation.
--
-- 5. Outstanding_balance (Vol 13_0 §4's Invoice shape) is set once, at
--    invoice creation, equal to grand_total, and never updated by
--    this migration — `public.payments` doesn't exist until Sprint 29
--    (Vol 13_0 §4's own Payment table), so there is nothing yet to
--    net it against. Disclosed, not silently left half-implemented.
--
-- 6. `Invoice.due_date` uses Party.credit_terms_days when set; Vol
--    13_0 doesn't specify a default when it's null, so this migration
--    defaults to 0 days (due on issue) — disclosed choice, easy to
--    revisit once a real owner preference is known.
--
-- 7. Ledger posting (SALE-001, "debit AR / credit Sales Revenue" —
--    Vol 13_0's own domain-flow text: "same posting rule SALE-001
--    already governs... no change to that PKA rule, only its trigger
--    point") is done via a direct, hand-balanced insert into
--    ledger_entries inside convert_quotation_to_invoice, NOT by
--    calling Sprint 26's public.post_ledger_entries. That RPC is
--    gated on 'configure' on accounting_reports — appropriate for a
--    human directly posting a manual journal entry, but wrong here:
--    the caller converting a quotation is a Sales Agent (capture on
--    sales only), and the posting is an automatic system consequence
--    of an already-authorized sales action, not a separate manual
--    entry they are choosing to make. Reusing post_ledger_entries's
--    RPC entry point would have made every such conversion fail for
--    the exact role this module is built for. The same table and the
--    same balanced-batch invariant are used either way (debit total
--    trivially equals credit total here, by construction — one debit
--    line, one credit line, both grand_total); this is a disclosed,
--    deliberate choice of entry point, not silent duplication.
--
-- 8. Two real, disclosed bug fixes to existing Sprint 25/27 code,
--    found while building on top of them (Sprint 28's own risk note
--    anticipated exactly this — "first real exercise... surfaces a
--    schema gap... fix it here, don't treat it as scope failure"):
--
--    a) public.resolve_price (Sprint 27) had NO authorization check
--       at all — SECURITY DEFINER with no caller_has_capability call,
--       meaning any authenticated user, even a non-member of the
--       business, could read pricing data for any business_id/
--       product_id/party_id triple. Sprint 27's own test suite never
--       caught this because it only exercised RLS-covered SELECTs on
--       the underlying tables, not this SECURITY DEFINER function
--       directly. Fixed here by adding a
--       caller_has_capability(business_id, 'pricing', 'view') check.
--
--    b) public.create_approval_task (Sprint 25) accepted no
--       "what should fire once this is approved" input, and
--       public.resolve_approval_task unconditionally overwrites
--       `next_action` on every resolve (it's reused there for a
--       different purpose — the blocked-awaiting-reviewer routing
--       message) — so Vol 13_0 §3.3's own field description ("next_
--       action: what fires automatically once approved, e.g. 'send
--       WhatsApp'") was never actually persisted by anything. Fixed
--       by adding a separate `on_approval_action` column that
--       create_approval_task now accepts and persists, left untouched
--       by resolve_approval_task's own next_action management.
-- ==============================================================

-- ------------------------------------------------------------
-- 0. Bug fixes to Sprint 25/27 code (see header notes 8a, 8b).
-- ------------------------------------------------------------

alter table public.approval_tasks
  add column if not exists on_approval_action text;

create or replace function public.create_approval_task(
  p_business_id uuid,
  p_domain text,
  p_subject_type text,
  p_subject_id uuid,
  p_amount numeric,
  p_ai_draft_summary text,
  p_ai_confidence numeric,
  p_captured_by_membership_id uuid,
  p_auto_approved boolean default false,
  p_on_approval_action text default null
) returns public.approval_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.approval_tasks;
begin
  if p_auto_approved and p_domain = 'payroll' then
    raise exception 'payroll_never_auto_approves: Vol 13_0 §10 bars payroll from resolved_via = auto_approved regardless of AI confidence';
  end if;

  if p_auto_approved then
    insert into public.approval_tasks (
      business_id, domain, subject_type, subject_id, amount,
      ai_draft_summary, ai_confidence, captured_by_membership_id,
      resolved_via, status, decided_at, on_approval_action
    ) values (
      p_business_id, p_domain, p_subject_type, p_subject_id, p_amount,
      p_ai_draft_summary, p_ai_confidence, p_captured_by_membership_id,
      'auto_approved', 'auto_approved', now(), p_on_approval_action
    )
    returning * into v_row;
    return v_row;
  end if;

  insert into public.approval_tasks (
    business_id, domain, subject_type, subject_id, amount,
    ai_draft_summary, ai_confidence, captured_by_membership_id,
    resolved_via, status, on_approval_action
  ) values (
    p_business_id, p_domain, p_subject_type, p_subject_id, p_amount,
    p_ai_draft_summary, p_ai_confidence, p_captured_by_membership_id,
    'escalation', -- placeholder, overwritten by resolve_approval_task below
    'pending_approval', p_on_approval_action
  )
  returning * into v_row;

  return public.resolve_approval_task(v_row.id);
end;
$$;

grant execute on function public.create_approval_task(uuid, text, text, uuid, numeric, text, numeric, uuid, boolean, text) to authenticated;

create or replace function public.resolve_price(
  p_business_id uuid, p_product_id uuid, p_party_id uuid
) returns table (unit_price numeric, price_type_id uuid, price_list_entry_id uuid, used_business_default boolean)
language plpgsql stable security definer set search_path = public, auth
as $$
declare v_party_price_type_id uuid; v_default_price_type_id uuid; v_row record;
begin
  if not public.caller_has_capability(p_business_id, 'pricing', 'view') then
    raise exception 'not_authorized: requires view on pricing';
  end if;

  if p_party_id is not null then
    select pty.price_type_id into v_party_price_type_id from public.parties pty
    where pty.id = p_party_id and pty.business_id = p_business_id;
  end if;
  if v_party_price_type_id is not null then
    select ple.unit_price as up, ple.price_type_id as pt, ple.id as id into v_row
    from public.price_list_entries ple
    where ple.product_id = p_product_id and ple.price_type_id = v_party_price_type_id
      and ple.effective_from <= current_date and (ple.effective_to is null or ple.effective_to >= current_date)
    order by ple.effective_from desc limit 1;
    if found then return query select v_row.up, v_row.pt, v_row.id, false; return; end if;
  end if;
  select id into v_default_price_type_id from public.price_types where business_id = p_business_id and is_default;
  if v_default_price_type_id is not null then
    select ple.unit_price as up, ple.price_type_id as pt, ple.id as id into v_row
    from public.price_list_entries ple
    where ple.product_id = p_product_id and ple.price_type_id = v_default_price_type_id
      and ple.effective_from <= current_date and (ple.effective_to is null or ple.effective_to >= current_date)
    order by ple.effective_from desc limit 1;
    if found then return query select v_row.up, v_row.pt, v_row.id, true; return; end if;
  end if;
  raise exception 'no_price_resolvable: no effective PriceListEntry for product % under the party''s price type or the business default', p_product_id;
end; $$;

grant execute on function public.resolve_price(uuid, uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 1. public.quotations / public.quotation_lines (Vol 13_0 §4, §3.2)
-- ------------------------------------------------------------
create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  quotation_no text not null,
  party_id uuid not null references public.parties (id),
  status text not null default 'draft' check (status in (
    'draft', 'sent', 'accepted', 'rejected', 'expired', 'converted_to_invoice'
  )),
  issue_date date not null default current_date,
  valid_until date,
  currency text not null default 'MYR',
  subtotal numeric(14, 2) not null default 0,
  tax_total numeric(14, 2) not null default 0,
  grand_total numeric(14, 2) not null default 0,
  notes text,
  converted_invoice_id uuid,
  captured_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now(),
  unique (business_id, quotation_no)
);
create index if not exists idx_quotations_business on public.quotations (business_id);
alter table public.quotations enable row level security;
create policy "Active members with sales view can see quotations"
  on public.quotations for select using (public.caller_has_capability(business_id, 'sales', 'view'));

create table if not exists public.quotation_lines (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations (id) on delete cascade,
  line_no integer not null,
  product_id uuid references public.products (id),
  description text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  unit_cost numeric(14, 2),
  tax_code text,
  discount_amount numeric(14, 2) not null default 0,
  line_total numeric(14, 2) not null,
  unique (quotation_id, line_no)
);
create index if not exists idx_quotation_lines_quotation on public.quotation_lines (quotation_id);
alter table public.quotation_lines enable row level security;
create policy "Active members with sales view can see quotation lines"
  on public.quotation_lines for select using (
    exists (select 1 from public.quotations q where q.id = quotation_lines.quotation_id
      and public.caller_has_capability(q.business_id, 'sales', 'view'))
  );

-- ------------------------------------------------------------
-- 2. public.invoices / public.invoice_lines (Vol 13_0 §4, §3.2)
-- ------------------------------------------------------------
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  invoice_no text not null,
  party_id uuid not null references public.parties (id),
  status text not null default 'issued' check (status in (
    'draft', 'issued', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled'
  )),
  issue_date date not null default current_date,
  due_date date not null,
  currency text not null default 'MYR',
  subtotal numeric(14, 2) not null default 0,
  tax_total numeric(14, 2) not null default 0,
  grand_total numeric(14, 2) not null default 0,
  notes text,
  source_quotation_id uuid references public.quotations (id),
  delivery_order_id uuid, -- no FK yet: public.delivery_orders doesn't exist until Sprint 31 (see header note 3)
  e_invoice_status text not null default 'not_applicable' check (e_invoice_status in (
    'not_applicable', 'pending', 'validated', 'rejected'
  )),
  outstanding_balance numeric(14, 2) not null default 0, -- see header note 5
  captured_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now(),
  unique (business_id, invoice_no)
);
create index if not exists idx_invoices_business on public.invoices (business_id);
alter table public.invoices enable row level security;
create policy "Active members with sales view can see invoices"
  on public.invoices for select using (public.caller_has_capability(business_id, 'sales', 'view'));

alter table public.quotations
  add constraint quotations_converted_invoice_id_fkey
  foreign key (converted_invoice_id) references public.invoices (id);

create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  line_no integer not null,
  product_id uuid references public.products (id),
  description text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  unit_cost numeric(14, 2),
  tax_code text,
  discount_amount numeric(14, 2) not null default 0,
  line_total numeric(14, 2) not null,
  unique (invoice_id, line_no)
);
create index if not exists idx_invoice_lines_invoice on public.invoice_lines (invoice_id);
alter table public.invoice_lines enable row level security;
create policy "Active members with sales view can see invoice lines"
  on public.invoice_lines for select using (
    exists (select 1 from public.invoices i where i.id = invoice_lines.invoice_id
      and public.caller_has_capability(i.business_id, 'sales', 'view'))
  );

-- ------------------------------------------------------------
-- 3. create_quotation: drafts a Quotation + lines, resolving each
-- line's price via PRICE-001 (Sprint 27's resolve_price) unless the
-- caller supplies an explicit override, then routes the whole thing
-- through the real ApprovalTask engine (domain='sales',
-- subject_type='quotation', on_approval_action='send WhatsApp').
-- p_lines: jsonb array of {product_id, description, quantity,
-- unit_price (optional override), discount_amount (optional)}.
-- ------------------------------------------------------------
create or replace function public.create_quotation(
  p_business_id uuid,
  p_party_id uuid,
  p_valid_until date,
  p_notes text,
  p_lines jsonb,
  p_ai_draft_summary text default null,
  p_auto_approved boolean default false
) returns public.quotations
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_quotation_no text;
  v_quotation public.quotations;
  v_line jsonb;
  v_line_no integer := 0;
  v_product_id uuid;
  v_quantity numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_resolved record;
begin
  if not public.caller_has_capability(p_business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'no_lines_supplied';
  end if;
  if not exists (select 1 from public.parties where id = p_party_id and business_id = p_business_id) then
    raise exception 'party_not_found_for_this_business: %', p_party_id;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
  values (p_business_id, 'quotation', 'QTN', 'never')
  on conflict (business_id, document_type) do nothing;
  v_quotation_no := public.next_document_number(p_business_id, 'quotation');

  insert into public.quotations (
    business_id, quotation_no, party_id, valid_until, notes, captured_by_membership_id
  ) values (
    p_business_id, v_quotation_no, p_party_id, p_valid_until, p_notes, v_caller_membership_id
  ) returning * into v_quotation;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_line_no := v_line_no + 1;
    v_product_id := nullif(v_line ->> 'product_id', '')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_discount := coalesce((v_line ->> 'discount_amount')::numeric, 0);

    if v_line ? 'unit_price' and (v_line ->> 'unit_price') is not null then
      v_unit_price := (v_line ->> 'unit_price')::numeric;
    elsif v_product_id is not null then
      select r.unit_price into v_unit_price from public.resolve_price(p_business_id, v_product_id, p_party_id) r;
    else
      raise exception 'line_%_needs_either_product_id_or_an_explicit_unit_price', v_line_no;
    end if;

    v_line_total := (v_quantity * v_unit_price) - v_discount;
    v_subtotal := v_subtotal + v_line_total;

    insert into public.quotation_lines (
      quotation_id, line_no, product_id, description, quantity, unit_price, discount_amount, line_total
    ) values (
      v_quotation.id, v_line_no, v_product_id, v_line ->> 'description', v_quantity, v_unit_price, v_discount, v_line_total
    );
  end loop;

  update public.quotations set subtotal = v_subtotal, tax_total = 0, grand_total = v_subtotal
  where id = v_quotation.id
  returning * into v_quotation;

  perform public.create_approval_task(
    p_business_id, 'sales', 'quotation', v_quotation.id, v_quotation.grand_total,
    coalesce(p_ai_draft_summary, 'Quotation ' || v_quotation_no || ' for ' || v_quotation.grand_total || ' ' || v_quotation.currency),
    null, v_caller_membership_id, p_auto_approved, 'send WhatsApp'
  );

  return v_quotation;
end;
$$;

grant execute on function public.create_quotation(uuid, uuid, date, text, jsonb, text, boolean) to authenticated;

-- ------------------------------------------------------------
-- 4. Sync trigger: an internally-rejected ApprovalTask propagates to
-- the quotation's own status (see header note 4 on why the reverse —
-- "approved" — deliberately does NOT propagate).
-- ------------------------------------------------------------
create or replace function public.sync_quotation_status_on_task_rejection()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.subject_type = 'quotation' and new.status = 'rejected' and old.status is distinct from new.status then
    update public.quotations set status = 'rejected'
    where id = new.subject_id and status = 'draft';
  end if;
  return new;
end;
$$;

create trigger trg_sync_quotation_status_on_task_rejection
  after update on public.approval_tasks
  for each row execute function public.sync_quotation_status_on_task_rejection();

-- ------------------------------------------------------------
-- 5. WhatsApp click-to-chat (Vol 13_0 §4.1, owner's Sprint 21 choice).
-- Deterministic message/link generation — a lookup + template, not an
-- AI classification, same posture as BANK-001/PRICE-001.
-- ------------------------------------------------------------
create or replace function public.build_whatsapp_quotation_link(p_quotation_id uuid)
returns table (phone_e164 text, message_text text, wa_link text)
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_quotation public.quotations;
  v_party public.parties;
  v_task_status text;
  v_digits text;
  v_message text;
begin
  select * into v_quotation from public.quotations where id = p_quotation_id;
  if not found then raise exception 'quotation_not_found: %', p_quotation_id; end if;
  if not public.caller_has_capability(v_quotation.business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;

  select status into v_task_status from public.approval_tasks
  where subject_type = 'quotation' and subject_id = p_quotation_id
  order by created_at desc limit 1;
  if v_task_status is null or v_task_status not in ('approved', 'auto_approved') then
    raise exception 'quotation_not_yet_approved: current approval status %', coalesce(v_task_status, 'none');
  end if;

  select * into v_party from public.parties where id = v_quotation.party_id;
  if v_party.contact_phone is null or btrim(v_party.contact_phone) = '' then
    raise exception 'party_has_no_contact_phone: %', v_party.id;
  end if;

  v_digits := regexp_replace(v_party.contact_phone, '[^0-9]', '', 'g');
  v_message := format(
    'Hi %s, here is your quotation %s from us, total %s %s. Valid until %s. Thank you!',
    v_party.display_name, v_quotation.quotation_no, v_quotation.currency, v_quotation.grand_total,
    coalesce(v_quotation.valid_until::text, 'further notice')
  );

  return query select v_digits, v_message, 'https://wa.me/' || v_digits || '?text=' || replace(replace(v_message, ' ', '%20'), E'\n', '%0A');
end;
$$;

grant execute on function public.build_whatsapp_quotation_link(uuid) to authenticated;

-- mark_quotation_sent: the owner's own confirmation that they tapped
-- Send in WhatsApp (Vol 13_0 §4.1 — "not 'AiFA sends it,' the owner
-- does" — the server has no way to observe this externally, so this
-- is deliberately a self-reported action, not an inferred one).
create or replace function public.mark_quotation_sent(p_quotation_id uuid)
returns public.quotations language plpgsql security definer set search_path = public, auth
as $$
declare v_quotation public.quotations; v_task_status text;
begin
  select * into v_quotation from public.quotations where id = p_quotation_id;
  if not found then raise exception 'quotation_not_found: %', p_quotation_id; end if;
  if not public.caller_has_capability(v_quotation.business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;
  if v_quotation.status <> 'draft' then
    raise exception 'quotation_not_in_draft_status: current status %', v_quotation.status;
  end if;
  select status into v_task_status from public.approval_tasks
  where subject_type = 'quotation' and subject_id = p_quotation_id
  order by created_at desc limit 1;
  if v_task_status is null or v_task_status not in ('approved', 'auto_approved') then
    raise exception 'quotation_not_yet_approved: current approval status %', coalesce(v_task_status, 'none');
  end if;
  update public.quotations set status = 'sent' where id = p_quotation_id returning * into v_quotation;
  return v_quotation;
end;
$$;

grant execute on function public.mark_quotation_sent(uuid) to authenticated;

create or replace function public.mark_quotation_accepted(p_quotation_id uuid)
returns public.quotations language plpgsql security definer set search_path = public, auth
as $$
declare v_quotation public.quotations;
begin
  select * into v_quotation from public.quotations where id = p_quotation_id;
  if not found then raise exception 'quotation_not_found: %', p_quotation_id; end if;
  if not public.caller_has_capability(v_quotation.business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;
  if v_quotation.status <> 'sent' then
    raise exception 'quotation_not_in_sent_status: current status %', v_quotation.status;
  end if;
  update public.quotations set status = 'accepted' where id = p_quotation_id returning * into v_quotation;
  return v_quotation;
end;
$$;

grant execute on function public.mark_quotation_accepted(uuid) to authenticated;

create or replace function public.mark_quotation_rejected(p_quotation_id uuid)
returns public.quotations language plpgsql security definer set search_path = public, auth
as $$
declare v_quotation public.quotations;
begin
  select * into v_quotation from public.quotations where id = p_quotation_id;
  if not found then raise exception 'quotation_not_found: %', p_quotation_id; end if;
  if not public.caller_has_capability(v_quotation.business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;
  if v_quotation.status <> 'sent' then
    raise exception 'quotation_not_in_sent_status: current status %', v_quotation.status;
  end if;
  update public.quotations set status = 'rejected' where id = p_quotation_id returning * into v_quotation;
  return v_quotation;
end;
$$;

grant execute on function public.mark_quotation_rejected(uuid) to authenticated;

-- ------------------------------------------------------------
-- 6. convert_quotation_to_invoice: copies lines, computes due_date
-- from Party.credit_terms_days (see header note 6), links both ways,
-- and posts SALE-001's ledger entries (see header note 7).
-- ------------------------------------------------------------
create or replace function public.convert_quotation_to_invoice(p_quotation_id uuid)
returns public.invoices
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_quotation public.quotations;
  v_party public.parties;
  v_caller_membership_id uuid;
  v_invoice_no text;
  v_invoice public.invoices;
  v_due_date date;
  v_ar_account_id uuid;
  v_revenue_account_id uuid;
  v_line record;
begin
  select * into v_quotation from public.quotations where id = p_quotation_id for update;
  if not found then raise exception 'quotation_not_found: %', p_quotation_id; end if;
  if not public.caller_has_capability(v_quotation.business_id, 'sales', 'capture') then
    raise exception 'not_authorized: requires capture on sales';
  end if;
  if v_quotation.status <> 'accepted' then
    raise exception 'quotation_not_accepted: current status %', v_quotation.status;
  end if;

  select bm.id into v_caller_membership_id from public.business_memberships bm
  where bm.business_id = v_quotation.business_id and bm.user_id = auth.uid() and bm.status = 'active';

  select * into v_party from public.parties where id = v_quotation.party_id;
  v_due_date := current_date + coalesce(v_party.credit_terms_days, 0);

  insert into public.document_number_sequences (business_id, document_type, prefix, reset_period)
  values (v_quotation.business_id, 'invoice', 'INV', 'never')
  on conflict (business_id, document_type) do nothing;
  v_invoice_no := public.next_document_number(v_quotation.business_id, 'invoice');

  insert into public.invoices (
    business_id, invoice_no, party_id, status, due_date, currency,
    subtotal, tax_total, grand_total, notes, source_quotation_id,
    outstanding_balance, captured_by_membership_id
  ) values (
    v_quotation.business_id, v_invoice_no, v_quotation.party_id, 'issued', v_due_date, v_quotation.currency,
    v_quotation.subtotal, v_quotation.tax_total, v_quotation.grand_total, v_quotation.notes, v_quotation.id,
    v_quotation.grand_total, v_caller_membership_id
  ) returning * into v_invoice;

  for v_line in select * from public.quotation_lines where quotation_id = v_quotation.id order by line_no loop
    insert into public.invoice_lines (
      invoice_id, line_no, product_id, description, quantity, unit_price, unit_cost, tax_code, discount_amount, line_total
    ) values (
      v_invoice.id, v_line.line_no, v_line.product_id, v_line.description, v_line.quantity, v_line.unit_price,
      v_line.unit_cost, v_line.tax_code, v_line.discount_amount, v_line.line_total
    );
  end loop;

  update public.quotations set status = 'converted_to_invoice', converted_invoice_id = v_invoice.id
  where id = v_quotation.id;

  -- SALE-001: debit Accounts Receivable, credit Sales Revenue — see
  -- header note 7 for why this is a direct insert rather than a call
  -- to post_ledger_entries.
  if v_invoice.grand_total > 0 then
    select id into v_ar_account_id from public.chart_of_accounts
    where business_id = v_quotation.business_id and account_code = '1100';
    select id into v_revenue_account_id from public.chart_of_accounts
    where business_id = v_quotation.business_id and account_code = '4000';
    if v_ar_account_id is null or v_revenue_account_id is null then
      raise exception 'chart_of_accounts_missing_expected_accounts: business % is missing 1100/4000', v_quotation.business_id;
    end if;
    insert into public.ledger_entries (business_id, chart_of_accounts_id, direction, amount, currency, posted_by_membership_id)
    values
      (v_quotation.business_id, v_ar_account_id, 'debit', v_invoice.grand_total, v_invoice.currency, v_caller_membership_id),
      (v_quotation.business_id, v_revenue_account_id, 'credit', v_invoice.grand_total, v_invoice.currency, v_caller_membership_id);
  end if;

  return v_invoice;
end;
$$;

grant execute on function public.convert_quotation_to_invoice(uuid) to authenticated;

-- End of Sprint 28 migration.
