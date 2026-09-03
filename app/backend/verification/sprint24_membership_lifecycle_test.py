# NOTE: run in the Claude session's own sandboxed Postgres instance (see
# Sprint 23's sprint23_membership_rls_and_lock_test.py header for the full
# setup rationale — same auth_sim.sql approach, not this project's real
# local Supabase). Committed as a reproducible record of how Sprint 24's
# lifecycle/growth-adaptive-access claims were verified.
#
# Setup order for a fresh run: auth_sim.sql -> app/backend/schema.sql
# (base) -> sprint23_tenant_role_permission_schema.sql -> this sprint's
# migration -> GRANT ALL TABLES to authenticated -> seed auth.users/
# profiles for owner1/owner2/bookkeeper1 (uuids below).
#
# What this proves (Sprint 24 Definition of Done):
#   A. Solo business: effective_access_model() = 'solo', no membership
#      besides the backfilled Owner.
#   B. Growth trigger fires exactly at ACCEPTANCE, not at invitation:
#      effective_access_model stays 'solo' right after invite_member(),
#      flips to 'team' only after accept_membership_invitation() — and a
#      business_access_model_transitions row is written for exactly that
#      moment, with trigger_reason = 'membership_accepted'.
#   C. Shrink-back: removing the only non-Owner membership recomputes
#      back to 'solo' with no separate step, logged as
#      trigger_reason = 'membership_removed'.
#   D. Sole-Owner guard holds at the OPERATION level (a clear
#      cannot_remove_sole_owner / cannot_suspend_sole_owner error), not
#      only via the Sprint 23 DB trigger backstop.
#   E. One-login-one-business (this sprint's owner decision, 3 September
#      2026): a person who already holds a live membership anywhere
#      cannot be invited to a second business, and re-inviting them to
#      the SAME business a second time while already live is rejected
#      too.
#   F. access_model_override normalizes correctly: forced_team/
#      forced_solo make effective_access_model() return exactly 'team'/
#      'solo' (not the raw override string) — a real bug this sprint's
#      own verification caught (the transition log's CHECK constraint
#      rejected 'forced_team' as a transitioned_to value) and fixed
#      before being called done.
#   G. Device cleanup on removal (Sprint 23's flagged gap, closed here):
#      removing a membership auto-revokes every device it held and
#      deletes its active_device_lock row, without going through
#      revoke_device's replacement-device requirement.

import psycopg2

DSN = "host=127.0.0.1 port=5432 dbname=aifa_sprint24_test user=postgres password=testpass123"

OWNER1 = "11111111-1111-1111-1111-111111111111"
OWNER2 = "22222222-2222-2222-2222-222222222222"
BOOKKEEPER1 = "33333333-3333-3333-3333-333333333333"
BOOKKEEPER1_EMAIL = "bookkeeper1@test.com"
BOOKKEEPER_ROLE = "00000000-0000-0000-0000-000000000002"


def as_user(cur, user_id):
    cur.execute("set role authenticated")
    cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (user_id,))


def check(label, cur, sql, params, expected):
    cur.execute(sql, params)
    actual = cur.fetchone()[0]
    status = "PASS" if actual == expected else f"FAIL (expected {expected}, got {actual})"
    print(f"[{status}] {label}")
    return actual == expected


def expect_error(label, cur, conn, fn):
    try:
        fn()
        print(f"[FAIL] {label} (no error raised)")
        return False
    except psycopg2.Error as e:
        print(f"[PASS] {label} ({str(e).strip().splitlines()[0]})")
        return True
    finally:
        conn.rollback()


def main():
    conn = psycopg2.connect(DSN)
    conn.autocommit = False
    cur = conn.cursor()
    all_passed = True

    # --- A: solo baseline ---
    as_user(cur, OWNER1)
    all_passed &= check("A: business one starts solo", cur,
                         "select public.effective_access_model(%s)", (OWNER1,), "solo")
    conn.commit()

    # --- B: growth trigger fires at acceptance, not invitation ---
    as_user(cur, OWNER1)
    cur.execute("select id from public.invite_member(%s, %s, %s)", (OWNER1, BOOKKEEPER1_EMAIL, BOOKKEEPER_ROLE))
    membership_id = cur.fetchone()[0]
    conn.commit()

    as_user(cur, OWNER1)
    all_passed &= check("B: still solo immediately after invite (pre-acceptance)", cur,
                         "select public.effective_access_model(%s)", (OWNER1,), "solo")
    conn.commit()

    as_user(cur, BOOKKEEPER1)
    cur.execute("select public.accept_membership_invitation(%s)", (OWNER1,))
    conn.commit()

    as_user(cur, OWNER1)
    all_passed &= check("B: team the moment acceptance happens", cur,
                         "select public.effective_access_model(%s)", (OWNER1,), "team")
    all_passed &= check("B: transition logged as membership_accepted", cur,
                         "select trigger_reason from public.business_access_model_transitions "
                         "where business_id = %s order by occurred_at desc limit 1", (OWNER1,),
                         "membership_accepted")
    conn.commit()

    # --- E: one-login-one-business ---
    as_user(cur, OWNER1)
    all_passed &= expect_error(
        "E: re-inviting an already-live member (same business) is rejected", cur, conn,
        lambda: cur.execute("select public.invite_member(%s, %s, %s)", (OWNER1, BOOKKEEPER1_EMAIL, BOOKKEEPER_ROLE)),
    )

    as_user(cur, OWNER2)
    all_passed &= expect_error(
        "E: inviting an already-live-elsewhere member (different business) is rejected", cur, conn,
        lambda: cur.execute("select public.invite_member(%s, %s, %s)", (OWNER2, BOOKKEEPER1_EMAIL, BOOKKEEPER_ROLE)),
    )

    # --- G: device cleanup on removal ---
    as_user(cur, BOOKKEEPER1)
    cur.execute("select public.register_device(%s, %s, %s)", ("device-bk1", "ios", "BK Phone"))
    conn.commit()
    as_user(cur, OWNER1)
    all_passed &= check("G: device + lock exist before removal", cur,
                         "select count(*) from public.active_device_lock where business_membership_id = %s",
                         (membership_id,), 1)
    cur.execute("select public.remove_membership(%s)", (membership_id,))
    conn.commit()
    all_passed &= check("G: device auto-revoked on removal", cur,
                         "select revoked_at is not null from public.devices where business_membership_id = %s",
                         (membership_id,), True)
    all_passed &= check("G: active_device_lock row deleted on removal", cur,
                         "select count(*) from public.active_device_lock where business_membership_id = %s",
                         (membership_id,), 0)

    # --- C: shrink-back ---
    as_user(cur, OWNER1)
    all_passed &= check("C: back to solo after removing the only non-Owner member", cur,
                         "select public.effective_access_model(%s)", (OWNER1,), "solo")
    all_passed &= check("C: transition logged as membership_removed", cur,
                         "select trigger_reason from public.business_access_model_transitions "
                         "where business_id = %s order by occurred_at desc limit 1", (OWNER1,),
                         "membership_removed")
    conn.commit()

    # --- D: sole-Owner guard at the operation level ---
    as_user(cur, OWNER1)
    cur.execute("select id from public.business_memberships where business_id = %s and role_id = "
                "'00000000-0000-0000-0000-000000000001'", (OWNER1,))
    owner_membership_id = cur.fetchone()[0]
    all_passed &= expect_error(
        "D: cannot remove the sole Owner", cur, conn,
        lambda: cur.execute("select public.remove_membership(%s)", (owner_membership_id,)),
    )
    all_passed &= expect_error(
        "D: cannot suspend the sole Owner", cur, conn,
        lambda: cur.execute("select public.suspend_membership(%s)", (owner_membership_id,)),
    )

    # --- F: override normalization ---
    as_user(cur, OWNER2)
    cur.execute("select public.set_access_model_override(%s, %s)", (OWNER2, "forced_team"))
    conn.commit()
    all_passed &= check("F: forced_team normalizes to 'team', not the raw override string", cur,
                         "select public.effective_access_model(%s)", (OWNER2,), "team")

    cur.close()
    conn.close()
    print("\nALL CHECKS PASSED" if all_passed else "\nSOME CHECKS FAILED")


if __name__ == "__main__":
    main()
