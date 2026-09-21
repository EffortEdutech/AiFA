-- Grant table-level SELECT to `authenticated` for direct-read access.
--
-- Found during Sprint 40's first-ever live verification against a real
-- Supabase instance (Phase 1-3's backend, built across Sprints 12-36, had
-- never actually been run against a live database before now). schema.sql
-- grants `execute` on every RPC function to `authenticated` (119 grants),
-- which is sufficient for every write path (all mutating functions are
-- `security definer`, so they run with the function owner's privileges
-- regardless of the caller's own table grants) — but it never grants plain
-- table-level SELECT, because it was written assuming Supabase's legacy
-- "auto_expose_new_tables" behaviour (new tables' privileges granted
-- automatically). This local CLI's default no longer does that ("matching
-- the new cloud default" per supabase/config.toml's own comment), so every
-- "read directly against the table" pattern used since Sprint 19
-- (getAllDevices) and reused in Sprints 38-40's own lib/*.ts helpers was
-- silently never actually exercised against a real backend until today.
--
-- RLS remains the real per-row access control on every one of these
-- tables (verified table-by-table across Sprints 38-40) — this migration
-- only unlocks the ability to query at all; it grants nothing a policy
-- doesn't still filter.
--
-- `alter default privileges` covers any table created by later migrations
-- too, so this doesn't need repeating every sprint.

grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
alter default privileges in schema public grant select on tables to authenticated;
