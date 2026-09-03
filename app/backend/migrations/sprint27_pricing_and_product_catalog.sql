-- ==============================================================
-- AIFA backend schema — Sprint 27 (Vol 13_0 §5 Harga & Kos Jualan;
-- §7's ProductImportBatch, pulled forward per this sprint's own plan).
--
-- Pricing & Product Catalog — products, price types, the price-list
-- resolution rule (PRICE-001) Sprint 28's Invoice/Quotation module
-- depends on, and a staging-first Excel product import.
--
-- SCOPE NOTE on Excel import, disclosed rather than silently assumed:
-- this sprint's own Risks table calls for a real sample file from the
-- owner before finalising the parser; none was available while writing
-- this migration. The staging schema below (product_import_batches /
-- product_import_rows) is real, tested, and format-agnostic — raw_data
-- is kept as JSONB per row precisely so it isn't locked to one column
-- layout — but the client-side header-matching parser
-- (packages/core/src/catalog/productImportParser.ts) uses conventional
-- header names (SKU/Product Code, Name/Description, Unit/UOM, Cost) as
-- a reasonable starting guess, not something validated against the
-- owner's actual product list. Flagged in this sprint's own doc
-- Outcomes as needing that validation pass once a real file exists —
-- same "time-box, small additive refinement expected" discipline this
-- sprint's own Risks table already names for document numbering in
-- Sprint 28.
-- ==============================================================

-- ------------------------------------------------------------
-- 1. public.price_types (Vol 13_0 §5). The first PriceType a business
-- creates becomes its default automatically (a business cannot have
-- zero default price types once it has any) — `set_default_price_type`
-- is how an owner changes which one later.
-- ------------------------------------------------------------
create table if not exists public.price_types (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);

-- At most one default per business — mirrors business_memberships_one_
-- active_owner's own partial-unique-index pattern.
create unique index if not exists price_types_one_default_per_business
  on public.price_types (business_id)
  where is_default;

alter table public.price_types enable row level security;

create policy "Active members with pricing view can see price types"
  on public.price_types for select
  using (public.caller_has_capability(business_id, 'pricing', 'view'));

create or replace function public.create_price_type(
  p_business_id uuid,
  p_name text
) returns public.price_types
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.price_types;
  v_is_first boolean;
begin
  if not public.caller_has_capability(p_business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;

  select not exists (select 1 from public.price_types where business_id = p_business_id) into v_is_first;

  insert into public.price_types (business_id, name, is_default)
  values (p_business_id, p_name, v_is_first)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_price_type(uuid, text) to authenticated;

create or replace function public.set_default_price_type(
  p_business_id uuid,
  p_price_type_id uuid
) returns public.price_types
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.price_types;
begin
  if not public.caller_has_capability(p_business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;
  if not exists (select 1 from public.price_types where id = p_price_type_id and business_id = p_business_id) then
    raise exception 'price_type_not_found_for_this_business: %', p_price_type_id;
  end if;

  update public.price_types set is_default = false where business_id = p_business_id and is_default;
  update public.price_types set is_default = true where id = p_price_type_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.set_default_price_type(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 1a. Now that PriceType exists, give business_memberships... no —
-- `parties.price_type_id` (added Sprint 26, deliberately without an FK
-- since PriceType didn't exist yet) gets its foreign key now.
-- ------------------------------------------------------------
alter table public.parties
  add constraint parties_price_type_id_fkey
  foreign key (price_type_id) references public.price_types (id);

create or replace function public.set_party_price_type(
  p_party_id uuid,
  p_price_type_id uuid
) returns public.parties
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_business_id uuid;
  v_row public.parties;
begin
  select business_id into v_business_id from public.parties where id = p_party_id;
  if v_business_id is null then
    raise exception 'party_not_found: %', p_party_id;
  end if;
  if not public.caller_has_capability(v_business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;
  if p_price_type_id is not null and not exists (
    select 1 from public.price_types where id = p_price_type_id and business_id = v_business_id
  ) then
    raise exception 'price_type_not_found_for_this_business: %', p_price_type_id;
  end if;

  update public.parties set price_type_id = p_price_type_id
  where id = p_party_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.set_party_price_type(uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 2. public.products (Vol 13_0 §5). `cost_source = 'auto_from_purchase'`
-- is in the CHECK constraint (schema is forward-compatible the moment
-- the Purchase module addendum ships) but `create_product` rejects it
-- server-side this sprint — a backstop behind "hide the option in UI
-- entirely" (this sprint's own Risks table), not a substitute for it.
-- ------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  sku text,
  name text not null,
  unit_of_measure text not null,
  default_cost numeric(14, 2),
  cost_source text not null default 'manual' check (cost_source in ('manual', 'auto_from_purchase')),
  track_inventory boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now(),
  unique (business_id, sku)
);

create index if not exists idx_products_business on public.products (business_id);

alter table public.products enable row level security;

create policy "Active members with pricing view can see products"
  on public.products for select
  using (public.caller_has_capability(business_id, 'pricing', 'view'));

create or replace function public.create_product(
  p_business_id uuid,
  p_sku text,
  p_name text,
  p_unit_of_measure text,
  p_default_cost numeric,
  p_cost_source text,
  p_track_inventory boolean
) returns public.products
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_row public.products;
begin
  if not public.caller_has_capability(p_business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;

  select bm.id into v_caller_membership_id
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if coalesce(p_cost_source, 'manual') = 'auto_from_purchase' then
    raise exception 'auto_from_purchase_not_yet_available: Purchase module addendum has not shipped (Vol 13_0 §5) — use manual for now';
  end if;

  insert into public.products (
    business_id, sku, name, unit_of_measure, default_cost, cost_source, track_inventory,
    created_by_membership_id
  ) values (
    p_business_id, nullif(p_sku, ''), p_name, p_unit_of_measure, p_default_cost,
    coalesce(p_cost_source, 'manual'), coalesce(p_track_inventory, false), v_caller_membership_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_product(uuid, text, text, text, numeric, text, boolean) to authenticated;

-- ------------------------------------------------------------
-- 3. public.price_list_entries (Vol 13_0 §5).
-- ------------------------------------------------------------
create table if not exists public.price_list_entries (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  price_type_id uuid not null references public.price_types (id),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  effective_from date not null default current_date,
  effective_to date,
  promo_note text,
  created_at timestamptz not null default now(),
  constraint price_list_entries_valid_window check (effective_to is null or effective_to >= effective_from)
);

create index if not exists idx_price_list_entries_product_type
  on public.price_list_entries (product_id, price_type_id, effective_from);

alter table public.price_list_entries enable row level security;

create policy "Active members with pricing view can see price list entries"
  on public.price_list_entries for select
  using (
    exists (
      select 1 from public.products p
      where p.id = price_list_entries.product_id
        and public.caller_has_capability(p.business_id, 'pricing', 'view')
    )
  );

create or replace function public.create_price_list_entry(
  p_product_id uuid,
  p_price_type_id uuid,
  p_unit_price numeric,
  p_effective_from date,
  p_effective_to date,
  p_promo_note text
) returns public.price_list_entries
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_business_id uuid;
  v_row public.price_list_entries;
begin
  select business_id into v_business_id from public.products where id = p_product_id;
  if v_business_id is null then
    raise exception 'product_not_found: %', p_product_id;
  end if;
  if not public.caller_has_capability(v_business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;
  if not exists (select 1 from public.price_types where id = p_price_type_id and business_id = v_business_id) then
    raise exception 'price_type_not_found_for_this_business: %', p_price_type_id;
  end if;

  insert into public.price_list_entries (
    product_id, price_type_id, unit_price, effective_from, effective_to, promo_note
  ) values (
    p_product_id, p_price_type_id, p_unit_price, coalesce(p_effective_from, current_date), p_effective_to, p_promo_note
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.create_price_list_entry(uuid, uuid, numeric, date, date, text) to authenticated;

-- ------------------------------------------------------------
-- 4. Governed rule PRICE-001 (Vol 13_0 §5) — implemented as a
-- deterministic SQL function, the same "recorded for governance/audit
-- provenance, applied deterministically" treatment
-- pka/accounting_rules.json's own BANK-001 entry already gives a rule
-- that isn't run through the AI-confidence classification pipeline.
-- PRICE-001's own JSON entry (packages/core/pka/accounting_rules.json)
-- cross-references this function by name so the rule's prose and its
-- runtime implementation don't drift apart.
--
-- Resolution order, matching Vol 13_0 §5 exactly for the "party has no
-- price type set" case, PLUS one disclosed extension: if the party's
-- own price type has no currently-effective PriceListEntry for this
-- product, this also falls back to the business default price type's
-- entry (rather than raising immediately) — the volume's text only
-- states the fallback for "customer has none set", not for "customer's
-- price type exists but this specific product has no entry for it";
-- erroring outright in that second case seemed a worse default than
-- falling back the same way, so it is called out here rather than left
-- to be discovered as a surprise.
-- ------------------------------------------------------------
create or replace function public.resolve_price(
  p_business_id uuid,
  p_product_id uuid,
  p_party_id uuid
) returns table (
  unit_price numeric,
  price_type_id uuid,
  price_list_entry_id uuid,
  used_business_default boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_party_price_type_id uuid;
  v_default_price_type_id uuid;
  v_row record;
begin
  if p_party_id is not null then
    select pty.price_type_id into v_party_price_type_id
    from public.parties pty
    where pty.id = p_party_id and pty.business_id = p_business_id;
  end if;

  if v_party_price_type_id is not null then
    select ple.unit_price as up, ple.price_type_id as pt, ple.id as id into v_row
    from public.price_list_entries ple
    where ple.product_id = p_product_id
      and ple.price_type_id = v_party_price_type_id
      and ple.effective_from <= current_date
      and (ple.effective_to is null or ple.effective_to >= current_date)
    order by ple.effective_from desc
    limit 1;

    if found then
      return query select v_row.up, v_row.pt, v_row.id, false;
      return;
    end if;
  end if;

  select id into v_default_price_type_id
  from public.price_types
  where business_id = p_business_id and is_default;

  if v_default_price_type_id is not null then
    select ple.unit_price as up, ple.price_type_id as pt, ple.id as id into v_row
    from public.price_list_entries ple
    where ple.product_id = p_product_id
      and ple.price_type_id = v_default_price_type_id
      and ple.effective_from <= current_date
      and (ple.effective_to is null or ple.effective_to >= current_date)
    order by ple.effective_from desc
    limit 1;

    if found then
      return query select v_row.up, v_row.pt, v_row.id, true;
      return;
    end if;
  end if;

  raise exception 'no_price_resolvable: no effective PriceListEntry for product % under the party''s price type or the business default', p_product_id;
end;
$$;

grant execute on function public.resolve_price(uuid, uuid, uuid) to authenticated;

-- ------------------------------------------------------------
-- 5. Product import staging (Vol 13_0 §7, pulled forward). Parse ->
-- validate -> owner review -> commit, same "never silently guess a bad
-- row" discipline Vol 0_1 §7 already applies to OCR failure. `raw_data`
-- is kept as JSONB per row deliberately (see this file's header) so the
-- staging schema itself isn't locked to one column layout even though
-- the client-side parser currently is.
-- ------------------------------------------------------------
create table if not exists public.product_import_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  source_file_ref text not null,
  status text not null default 'parsed' check (status in ('parsed', 'applied', 'failed')),
  row_count integer not null default 0,
  error_count integer not null default 0,
  created_by_membership_id uuid references public.business_memberships (id),
  created_at timestamptz not null default now()
);

alter table public.product_import_batches enable row level security;

create policy "Active members with pricing view can see import batches"
  on public.product_import_batches for select
  using (public.caller_has_capability(business_id, 'pricing', 'view'));

create table if not exists public.product_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.product_import_batches (id) on delete cascade,
  row_no integer not null,
  raw_data jsonb not null,
  parsed_sku text,
  parsed_name text,
  parsed_unit_of_measure text,
  parsed_default_cost numeric(14, 2),
  parse_status text not null check (parse_status in ('ok', 'error')),
  error_message text,
  created_product_id uuid references public.products (id),
  unique (batch_id, row_no)
);

create index if not exists idx_product_import_rows_batch on public.product_import_rows (batch_id);

alter table public.product_import_rows enable row level security;

create policy "Active members with pricing view can see import rows"
  on public.product_import_rows for select
  using (
    exists (
      select 1 from public.product_import_batches b
      where b.id = product_import_rows.batch_id
        and public.caller_has_capability(b.business_id, 'pricing', 'view')
    )
  );

-- create_product_import_batch: stages a whole parsed file's rows in one
-- call (the client does the actual Excel parsing — see this file's
-- header — and hands over already-parsed rows plus their raw source
-- data for audit). Every row lands as either parse_status='ok' or
-- 'error' with a message; nothing is silently dropped, and error rows
-- never create a product.
create or replace function public.create_product_import_batch(
  p_business_id uuid,
  p_source_file_ref text,
  p_rows jsonb
) returns public.product_import_batches
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller_membership_id uuid;
  v_batch public.product_import_batches;
  v_row jsonb;
  v_row_no integer := 0;
  v_error_count integer := 0;
  v_row_count integer := 0;
begin
  if not public.caller_has_capability(p_business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;

  select bm.id into v_caller_membership_id
  from public.business_memberships bm
  where bm.business_id = p_business_id and bm.user_id = auth.uid() and bm.status = 'active';

  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    raise exception 'no_rows_supplied';
  end if;

  insert into public.product_import_batches (business_id, source_file_ref, status, created_by_membership_id)
  values (p_business_id, p_source_file_ref, 'parsed', v_caller_membership_id)
  returning * into v_batch;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_row_no := v_row_no + 1;
    v_row_count := v_row_count + 1;
    if (v_row ->> 'parse_status') = 'error' then
      v_error_count := v_error_count + 1;
    end if;
    insert into public.product_import_rows (
      batch_id, row_no, raw_data, parsed_sku, parsed_name, parsed_unit_of_measure,
      parsed_default_cost, parse_status, error_message
    ) values (
      v_batch.id,
      v_row_no,
      coalesce(v_row -> 'raw_data', v_row),
      nullif(v_row ->> 'sku', ''),
      nullif(v_row ->> 'name', ''),
      nullif(v_row ->> 'unit_of_measure', ''),
      nullif(v_row ->> 'default_cost', '')::numeric,
      coalesce(v_row ->> 'parse_status', 'error'),
      v_row ->> 'error_message'
    );
  end loop;

  update public.product_import_batches
  set row_count = v_row_count, error_count = v_error_count,
      status = case when v_error_count = v_row_count then 'failed' else 'parsed' end
  where id = v_batch.id
  returning * into v_batch;

  return v_batch;
end;
$$;

grant execute on function public.create_product_import_batch(uuid, text, jsonb) to authenticated;

-- apply_product_import_batch: owner-review commit step — only 'ok' rows
-- that don't already have a created_product_id get turned into real
-- Product rows; 'error' rows are left exactly as they are (never
-- silently dropped, never silently guessed into a product) for the
-- owner to correct and re-stage in a follow-up batch. Re-running this
-- on an already-applied batch is a safe no-op for rows already linked
-- to a product.
create or replace function public.apply_product_import_batch(
  p_batch_id uuid
) returns public.product_import_batches
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_batch public.product_import_batches;
  v_row record;
  v_new_product public.products;
begin
  select * into v_batch from public.product_import_batches where id = p_batch_id;
  if not found then
    raise exception 'import_batch_not_found: %', p_batch_id;
  end if;
  if not public.caller_has_capability(v_batch.business_id, 'pricing', 'capture') then
    raise exception 'not_authorized: requires capture on pricing';
  end if;

  for v_row in
    select * from public.product_import_rows
    where batch_id = p_batch_id and parse_status = 'ok' and created_product_id is null
  loop
    insert into public.products (business_id, sku, name, unit_of_measure, cost_source, track_inventory)
    values (v_batch.business_id, v_row.parsed_sku, v_row.parsed_name, v_row.parsed_unit_of_measure, 'manual', false)
    returning * into v_new_product;

    update public.product_import_rows set created_product_id = v_new_product.id where id = v_row.id;
  end loop;

  update public.product_import_batches set status = 'applied' where id = p_batch_id
  returning * into v_batch;

  return v_batch;
end;
$$;

grant execute on function public.apply_product_import_batch(uuid) to authenticated;

-- End of Sprint 27 migration.
