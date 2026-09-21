# Vol 13_4 — Business Onboarding & Creation

**Requested by:** the owner, while planning two seed businesses (NHL Global
Solution, Art Angkut Enterprise) to pilot AiFA for real — surfacing that no
sign-up-to-business path exists at all. Not part of Phase 4 (which built the
web frontend against Series 13 RPCs Phase 3 already shipped); this closes a
real gap in Series 13 itself.

## 1. The gap, precisely

`public.businesses` and `public.business_memberships` (Vol 13_1 §2, §4) are
fully designed and live in the schema. `invite_member` and
`accept_membership_invitation` (Vol 13_1 §4/§6) let an existing business add
more people. Nothing lets a new user create their OWN first business. The
only place a `businesses` row has ever been inserted is a one-off legacy
migration seed (schema.sql, Sprint ~14 backfill) — not callable from the
app. Every Phase 4 sprint's own Outcomes disclosed this as "the onboarding
gap," deferred by the owner's own repeated instruction, through Sprint 49.

## 2. Design, following the schema's own stated intent

`businesses.id` is deliberately the same UUID as the creating user's own
`auth.uid()` (Vol 13_1 §2's own comment: not a fresh surrogate key), and
Vol 13_1 §5's own note states multi-business-per-owner is explicitly out of
scope. So creation is simple and fits the existing shape exactly: one new
RPC, `create_business`, called once by a freshly signed-up user.

```sql
-- Also adds businesses.ssm_registration_number (plain nullable text, no
-- format validation -- formats vary by entity type). See supabase/
-- migrations/00000000000002_business_creation_and_ssm_number.sql for the
-- exact, applied migration (this block mirrors it).
create or replace function public.create_business(
  p_legal_name text,
  p_industry text default null,
  p_ssm_registration_number text default null
) returns public.businesses
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.businesses;
  v_owner_role_id constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  if p_legal_name is null or btrim(p_legal_name) = '' then
    raise exception 'legal_name_required';
  end if;

  if exists (select 1 from public.businesses where id = auth.uid()) then
    raise exception 'business_already_exists_for_this_login';
  end if;

  insert into public.businesses (
    id, owner_user_id, legal_name, industry, ssm_registration_number, pka_version
  )
  values (
    auth.uid(), auth.uid(), btrim(p_legal_name), nullif(btrim(p_industry), ''),
    nullif(btrim(p_ssm_registration_number), ''), 'v2.0'
  )
  returning * into v_row;

  insert into public.business_memberships (
    business_id, user_id, role_id, status, invited_at, accepted_at
  ) values (
    auth.uid(), auth.uid(), v_owner_role_id, 'active', now(), now()
  );

  return v_row;
end;
$$;

grant execute on function public.create_business(text, text, text) to authenticated;
```

`seed_chart_of_accounts_on_business_insert` (an existing trigger on
`businesses`, Sprint ~14) already fires on this insert with zero changes —
the new business gets its starting chart of accounts for free. Nothing else
in the schema needs to change.

**Guard against re-creation:** the `exists` check above is deliberate — a
login that already owns a business cannot call this twice (matches
`businesses.id` being a primary key referencing `auth.users(id)`, so a
second insert would fail the constraint anyway; the explicit check just
turns that into a named error rather than a raw constraint violation).

**Solo vs. team from the very first call:** `create_business` always makes
exactly one Owner membership. A business that wants a team from day one
(NHL Global Solution) reaches that the same way any existing business
would: the Owner calls the already-live `invite_member` right after, once
for each teammate. No new invite mechanism is needed.

## 3. Frontend surface (Phase 4's own pattern: read the account, branch)

`AppShell.tsx`'s bootstrap needs one new branch: after sign-in, if the
signed-in user has no row in `businesses` (a plain `select` guarded by
`businesses`' own RLS — visible to a user with zero memberships as "no
rows," not an error), route to a new `BusinessCreatePage.tsx` instead of
the shell. That page is a single form (legal name, industry) calling
`create_business`, then reloading into the normal shell once it returns —
the existing bootstrap/membership-loading path handles everything after
that unchanged, since it already handles "just-created, solo, Owner."

This is genuinely a small frontend addition (one new page, one branch in
bootstrap) plus the one RPC above — not a rebuild of anything Phase 4 built.

## 4. Explicitly out of scope here

- Multi-business-per-login (Vol 13_1 §5 already defers this to a future
  Vol 10_1-style true multi-tenant design — unchanged by this Vol).
- SSM registration number FORMAT validation (the column itself is added
  by this Vol, per owner decision 2026-09-04 — see §5).
- Polished invite-by-email UX beyond what Sprint 24 already shipped
  (`invite_member`'s own header already states "an email link or in-app
  code is enough, polish is out of scope" — this Vol does not revisit it).

## 5. Open items

1. **Login-per-business, not person-per-business.** Since one login owns
   at most one business, the owner needs a second email address to be
   Art Angkut Enterprise's Owner separately from NHL Global Solution's
   membership — a real constraint of the schema's own design (Vol 13_1
   §5), not new here, just newly load-bearing once two real businesses
   exist under one person.
