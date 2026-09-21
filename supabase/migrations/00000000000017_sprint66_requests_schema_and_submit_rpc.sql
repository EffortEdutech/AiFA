-- Sprint 66 -- Public Homepage Renderer (Architecture §2.3, §2.4 consumption
-- side; docs/aifa-platform/Architecture.md).
--
-- requests: minimal schema now so the Sprint 66 contact form is not a dead
-- end, per Sprint_Plan.md's own instruction ("Contact form submissions land
-- as a requests row (see Sprint 68) even before the full Request/Tracking
-- feature ships"). Sprint 68 is expected to extend this table (or add
-- request_status_events alongside it) and wire it into the existing
-- Universal Input Router / ApprovalTask pipeline (Phase 5, Vol 5_5) -- this
-- sprint only needs a real landing spot for a real public submission, same
-- schema-now/populate-later precedent as public_documents in Sprint 64.

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  request_type text not null default 'contact' check (request_type in ('contact', 'rfq', 'po')),
  payload jsonb not null,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

comment on table public.requests is
  'Sprint 66 (Architecture §2.3/§2.5) -- minimal schema for public-facing submissions (contact form for now; RFQ/PO from Sprint 68). Written only via submit_public_request() from the public homepage -- no direct anon INSERT policy. Sprint 68 is expected to extend this table and wire status changes into the existing ApprovalTask pipeline (Phase 5).';

create index idx_requests_business_id on public.requests (business_id);

alter table public.requests enable row level security;

create policy "Members can view their own business's requests"
  on public.requests
  for select
  using (is_active_member(business_id));

-- Public submission RPC -- callable by anon (a website visitor has no
-- account), same SECURITY DEFINER convention this schema already uses for
-- every other write path. Only requires that business_id names a real
-- business -- a visitor only ever gets a business_id from resolve_domain()
-- (Sprint 65), which only returns a VERIFIED domain's business, so this
-- cannot be used to spam an arbitrary/unverified business_id sight unseen,
-- though it does not re-check verification itself (a business could still
-- remove its domain after a visitor already loaded the page -- an accepted,
-- low-risk gap for a contact form, not a financial write).
create or replace function public.submit_public_request(
  p_business_id uuid,
  p_request_type text,
  p_payload jsonb
) returns public.requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.requests;
begin
  if not exists (select 1 from public.businesses where id = p_business_id) then
    raise exception 'unknown_business';
  end if;

  if p_request_type not in ('contact', 'rfq', 'po') then
    raise exception 'invalid_request_type';
  end if;

  insert into public.requests (business_id, request_type, payload)
  values (p_business_id, p_request_type, coalesce(p_payload, '{}'::jsonb))
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.submit_public_request(uuid, text, jsonb) to anon, authenticated;
