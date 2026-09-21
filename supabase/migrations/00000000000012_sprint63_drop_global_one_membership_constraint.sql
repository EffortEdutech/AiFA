-- Sprint 63 follow-up #2 -- discovered live while regression-testing
-- 00000000000010_sprint63_multi_business_per_owner.sql.
--
-- business_memberships_one_live_globally enforced at most one
-- invited/active/suspended membership row per user_id ACROSS THE WHOLE
-- TABLE (not scoped to one business) -- the real database-level mechanism
-- behind the pre-Sprint-63 "one login owns at most one business" rule
-- (Vol 13_1 §5 / Vol 13_4 §4), independent of create_business's own
-- application-level guard already relaxed in migration 00000000000010.
-- Architecture §2.2 requires this to be relaxed too, or every second
-- create_business call for the same login fails here even after the id/
-- FK fix (confirmed live: this is exactly the error the un-migrated
-- schema threw during this sprint's own regression test).
--
-- Replaced with a narrower invariant that keeps the property this index
-- actually needs to protect -- a user cannot hold two live rows in the
-- SAME business -- without blocking a second, independent business:
drop index public.business_memberships_one_live_globally;

create unique index business_memberships_one_live_per_business
  on public.business_memberships (business_id, user_id)
  where status in ('invited', 'active', 'suspended');
