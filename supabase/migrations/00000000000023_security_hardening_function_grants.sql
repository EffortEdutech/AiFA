-- Security hardening (audit 29 Oct 2026, confirmed by the live Supabase advisors).
--
-- Problem: Postgres grants EXECUTE on every new function to PUBLIC, and this
-- project's migrations rarely revoked it. 164 SECURITY DEFINER functions were
-- callable through the API by the anonymous role, including internal helpers
-- that do not check the caller (resolve_approval_task, next_document_number,
-- recompute_invoice_balance, seed_phase1_chart_of_accounts, ...).
--
-- Fix, in three parts:
--   1. anon keeps EXECUTE only on the intended public RPCs plus the three
--      policy helpers (is_active_member, _has_sales_capability, caller_has_capability) (they return false for anon; keeping them avoids
--      "permission denied" if anon ever touches a table whose policy calls them).
--   2. Internal-only helpers (no client call sites, no policy use, no invoker
--      callers or triggers) are also removed from signed-in users.
--   3. New functions no longer default to anon/PUBLIC.
-- Also pins search_path on 7 functions the linter flagged, and records the
-- RLS that chain_definitions already has on the live database.
--
-- Follow-up (needs code changes, not done here): next_document_number,
-- create_approval_task and convert_quotation_to_invoice are called by the app
-- but do not verify that the caller belongs to the business.

-- 1. Reset function execute grants in the public schema.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;

grant execute on function public.resolve_domain(text) to anon;
grant execute on function public.resolve_business_slug(text) to anon;
grant execute on function public.get_current_business_slug(text) to anon;
grant execute on function public.get_public_business_name(uuid) to anon;
grant execute on function public.submit_public_request(uuid, text, jsonb) to anon;
grant execute on function public.get_request_tracking(text) to anon;
grant execute on function public.submit_public_request_v2(uuid, text, jsonb, text, text) to anon;
grant execute on function public.is_active_member(uuid) to anon;
grant execute on function public._has_sales_capability(uuid, text) to anon;
grant execute on function public.caller_has_capability(uuid, text, text) to anon;

-- 2. Internal helpers: not for the API at all.
revoke execute on function public._create_chained_intake(uuid, text, text, uuid, text) from authenticated;
revoke execute on function public._resolve_chained_intake(text, uuid, text) from authenticated;
revoke execute on function public.resolve_approval_task(uuid) from authenticated;
revoke execute on function public.recompute_invoice_balance(uuid) from authenticated;
revoke execute on function public.record_access_model_transition_if_changed(uuid, text, text) from authenticated;
revoke execute on function public.seed_phase1_chart_of_accounts(uuid) from authenticated;

-- 3. Future functions: signed-in users and the service role only.
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

-- 4. Pin search_path on the functions the linter flagged.
alter function public._assign_business_slug() set search_path = public, extensions;
alter function public._new_reference_code() set search_path = public, extensions;
alter function public._new_tracking_token() set search_path = public, extensions;
alter function public._slugify(text) set search_path = public, extensions;
alter function public.compute_statutory_deductions(numeric, date) set search_path = public, extensions;
alter function public.enforce_system_account_immutability() set search_path = public, extensions;
alter function public.map_domain_hint(text) set search_path = public, extensions;

-- 5. chain_definitions: RLS on, no policy = no direct API access. Only the
-- SECURITY DEFINER chaining functions read it. (Already true on the live
-- database; recorded here so a rebuilt database matches.)
alter table public.chain_definitions enable row level security;
