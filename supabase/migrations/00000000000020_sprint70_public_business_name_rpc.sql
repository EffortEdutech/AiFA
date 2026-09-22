-- Sprint 70 follow-up (21 September 2026) -- web-public/ bug fix.
--
-- web-public/app/site/[slug]/page.tsx reads businesses.legal_name using
-- the anon key (correctly -- it's a public-facing app, no service_role
-- key belongs there). But `businesses` only has "Members can view their
-- own business" RLS (is_active_member(id)) -- an anonymous visitor has no
-- membership, so that read silently returns zero rows, and the page fell
-- back to its "This business" placeholder instead of the real name.
-- supabase/functions/public-homepage never hit this because it uses a
-- service_role client, which bypasses RLS entirely.
--
-- Fix: a narrow, anon-callable RPC that returns only legal_name for a
-- given business_id -- same SECURITY DEFINER pattern as
-- resolve_business_slug() (Sprint 70) and resolve_domain() (Sprint 65).
-- A business's own display name is not sensitive (it's already shown on
-- its own public page); this does not open up the rest of the businesses
-- table, which stays exactly as RLS-protected as before.
create or replace function get_public_business_name(p_business_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select legal_name from businesses where id = p_business_id;
$$;

revoke all on function get_public_business_name(uuid) from public;
grant execute on function get_public_business_name(uuid) to anon, authenticated;
