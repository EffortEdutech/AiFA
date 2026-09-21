-- Sprint 66 fix -- service_role table GRANT gap (Architecture §2.4).
--
-- Discovered live: public-homepage and verify-domain (Sprint 65/66) are the
-- first code in this codebase to query tables directly via a service-role
-- admin client (`.from(...).select()/.update()`). Every other domain in
-- this project goes through SECURITY DEFINER RPC functions instead, which
-- run as the function owner and never needed service_role to hold table
-- grants directly. That meant service_role had never actually been granted
-- SELECT/INSERT/UPDATE on any of these tables -- confirmed via
-- information_schema.role_table_grants, and confirmed to be a project-wide,
-- longstanding gap by checking the pre-existing `invoices` table too (same
-- missing grants there).
--
-- Net effect before this fix: every public homepage request returned
-- "This site has not published any content yet." (silently swallowed
-- 42501 permission-denied from `public_site_content`/`businesses`), and
-- verify-domain's pg_cron-driven recheck likely silently failed its
-- `.update()` on `domains` on every single run since Sprint 65 (same root
-- cause; that call had -- and still has -- no error check of its own).
--
-- This migration only adds the grants; it does not change RLS. These
-- tables' RLS policies are unaffected and continue to protect anon/
-- authenticated access exactly as before -- service_role bypasses RLS by
-- Postgres/Supabase design once it holds the grant, which is the intended
-- behaviour for a server-side edge function admin client.

grant select on public.public_site_content to service_role;
grant select on public.businesses to service_role;
grant select, update on public.domains to service_role;
grant select, insert on public.requests to service_role;
