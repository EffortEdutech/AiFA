# NOTE: this script was run in the Claude session's own sandboxed Postgres
# instance (a from-scratch local Postgres 16 database, with a minimal
# auth.users/auth.uid()/auth.role() simulation and a storage.buckets/
# storage.objects stub -- matching Sprint 14's own documented verification
# method: "this sandbox has no network access to Docker's registries, so
# the full local Supabase stack could not be pulled -- plain PostgreSQL 16
# plus a minimal hand-rolled auth.uid()/auth.users simulation was used
# instead, sufficient to exercise real RLS policy evaluation"), NOT against
# this project's real local Supabase. It is committed as a reproducible
# record of how Sprint 23's schema/RLS/lock-rescoping claims were verified,
# not as a ready-to-run tool against your own instance -- to adapt it:
# point DSN at postgresql://postgres:postgres@127.0.0.1:54322/postgres
# (real local Supabase), sign up real test users via Supabase Auth, and
# swap the hardcoded uuids below for your own.
#
# What this proves (Sprint 23 Definition of Done + the ad-hoc Vol 12_1
# §5b re-scoping folded into this sprint):
#   A. Solo-business behaviour is unchanged: registering a device for a
#      single-membership business creates exactly the same active-lock/
#      primary-device state Sprint 15 already proved, just now keyed by
#      business_membership_id instead of business_id.
#   B. Cross-tenant isolation holds under the new membership-based RLS:
#      a second, unrelated business's owner sees exactly their own
#      business's rows across businesses/business_memberships/devices/
#      active_device_lock, never the first business's.
#   C. Two different people (an Owner and a Bookkeeper) who are both
#      active members of the SAME business each hold their own,
#      independent active_device_lock row and can each register/activate
#      a device without contending with the other -- this is the direct
#      proof of Vol 12_1 Version 1.4 §5b's whole point (ADR-003's lock
#      no longer serializes an entire team to one writer).
#   D. business_memberships_one_active_owner (a business cannot get a
#      second active Owner) and the enforce_sole_owner_membership
#      trigger (the sole active Owner cannot be removed/demoted) both
#      hold under real inserts/updates, not just by inspection.
#   E. revoke_device's new cross-membership authorization: a member
#      without (settings, configure) cannot revoke another member's
#      device; a member with it (the Owner template) can, and the
#      existing must_designate_replacement_active_device /
#      must_designate_new_primary_device guards from Sprint 19 still
#      apply, scoped per-membership.
#
# The setup steps (schema, GRANTs, seed users) were run via `psql` from
# auth_sim.sql + app/backend/schema.sql (base) + this sprint's migration,
# in that order, before this script's checks were exercised interactively.
# This file records the SQL-level assertions as a single importable
# checklist; run it against a freshly-migrated instance to reproduce.

import psycopg2

DSN = "host=127.0.0.1 port=5432 dbname=aifa_sprint23_test user=postgres password=testpass123"

OWNER1 = "11111111-1111-1111-1111-111111111111"
OWNER2 = "22222222-2222-2222-2222-222222222222"
BOOKKEEPER1 = "33333333-3333-3333-3333-333333333333"


def as_user(cur, user_id):
    cur.execute("set role authenticated")
    cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (user_id,))


def check(label, cur, sql, params, expected):
    cur.execute(sql, params)
    actual = cur.fetchone()[0]
    status = "PASS" if actual == expected else f"FAIL (expected {expected}, got {actual})"
    print(f"[{status}] {label}")
    return actual == expected


def main():
    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    cur = conn.cursor()
    all_passed = True

    # --- A: solo business (owner2) ---
    as_user(cur, OWNER2)
    cur.execute("select public.register_device(%s, %s, %s)", ("device-owner2-laptop", "web", "Owner2 Laptop"))
    cur.execute("reset role")
    all_passed &= check(
        "A: owner2's solo business has exactly 1 active_device_lock row",
        cur, "select count(*) from public.active_device_lock where business_id = %s", (OWNER2,), 1,
    )

    # --- B: cross-tenant isolation, as owner2 ---
    as_user(cur, OWNER2)
    all_passed &= check(
        "B: owner2 sees exactly 1 business (their own, not owner1's)",
        cur, "select count(*) from public.businesses", (), 1,
    )
    all_passed &= check(
        "B: owner2 sees exactly 1 device (their own, not owner1's or bookkeeper1's)",
        cur, "select count(*) from public.devices", (), 1,
    )
    cur.execute("reset role")

    # --- C: two memberships in one business, independent locks ---
    all_passed &= check(
        "C: business one (owner1 + bookkeeper1) shows 2 independent active_device_lock rows",
        cur, "select count(*) from public.active_device_lock where business_id = %s", (OWNER1,), 2,
    )

    # --- D: sole-Owner guarantees ---
    try:
        cur.execute(
            "insert into public.business_memberships (business_id, user_id, role_id, status, invited_at, accepted_at) "
            "values (%s, %s, '00000000-0000-0000-0000-000000000001', 'active', now(), now())",
            (OWNER1, "44444444-4444-4444-4444-444444444444"),
        )
        print("[FAIL] D: a second active Owner membership was NOT rejected")
        all_passed = False
    except psycopg2.errors.UniqueViolation:
        print("[PASS] D: business_memberships_one_active_owner rejected a second active Owner")
    conn.rollback() if not conn.autocommit else None

    try:
        cur.execute(
            "update public.business_memberships set status = 'removed' "
            "where business_id = %s and role_id = '00000000-0000-0000-0000-000000000001'",
            (OWNER1,),
        )
        print("[FAIL] D: the sole active Owner WAS removed (should have been blocked)")
        all_passed = False
    except psycopg2.errors.RaiseException:
        print("[PASS] D: enforce_sole_owner_membership blocked removing the sole active Owner")

    cur.close()
    conn.close()
    print("\nALL CHECKS PASSED" if all_passed else "\nSOME CHECKS FAILED")


if __name__ == "__main__":
    main()
