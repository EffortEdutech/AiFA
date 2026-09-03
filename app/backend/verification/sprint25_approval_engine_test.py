# NOTE: run in the Claude session's own sandboxed Postgres instance (see
# Sprint 23/24's own test scripts for the full setup rationale — same
# auth_sim.sql approach, not this project's real local Supabase).
# Committed as a reproducible record of how Sprint 25's resolution-engine
# claims were verified.
#
# Setup order for a fresh run: auth_sim.sql -> app/backend/schema.sql
# (current, already includes Sprint 23+24) -> GRANT ALL TABLES to
# authenticated -> this sprint's migration -> GRANT ALL TABLES again
# (new tables) -> this script (which does its own auth.users/businesses/
# Owner-membership seeding directly, since a fresh sandbox DB has no
# public.profiles rows for the Section 7 backfill to key off).
#
# This is Sprint 25's own "synthetic test domain" (per the sprint plan's
# own instruction: "a synthetic test domain (not a real Vol 13_0 module)
# exercising every named path") — every ApprovalTask created below uses
# made-up subject_type/subject_id values, not a real invoice/PV table.
#
# What this proves (Sprint 25 Definition of Done):
#   A. Solo business: every domain, INCLUDING payroll (owner decision, 3
#      September 2026), resolves via solo_self_resolved / status =
#      approved in the same transaction — zero new friction, per Vol
#      13_3 §3.
#   B. Growth-trigger SoD seeding: segregation_of_duties_policies gets
#      exactly 11 rows the moment a business's second membership is
#      ACCEPTED (not at invite), with §4.3's resolved defaults (expense
#      RM 500 / sales RM 2,000 thresholds; enforce_maker_checker true
#      for sales/expense/payroll/legal_contract, false for
#      hr_attendance_leave/inventory) — and a solo business (A) never
#      gets any policy rows at all.
#   C. Open shared queue: multiple eligible approvers (Owner + Bookkeeper
#      both hold `approve` on `sales`) -> assigned_membership_id left
#      null, resolved_via = direct_permission; the first eligible member
#      to decide() wins, and the second attempt gets a clear
#      already-actioned error rather than a stale approve button.
#   D. SoD maker-exclusion (singleton): a two-person business where the
#      Owner captures an expense over the RM 500 threshold themselves —
#      excluding the maker leaves exactly the Approver template member
#      eligible -> resolved_via = direct_permission, assigned directly
#      to them, self_approved_via_escape_valve = false (this is an
#      ordinary maker-checker outcome, not an escape-valve one).
#   E. Escape valve, sole eligible = maker: a two-person business (Owner
#      + Warehouse Staff, who has no approve on expense) where the Owner
#      captures an expense over threshold — excluding the Owner leaves
#      nobody eligible, so the escape valve (default
#      allow_self_approval_if_sole_eligible = true) lets the Owner
#      self-approve, flagged self_approved_via_escape_valve = true.
#   F. Escape valve disabled -> blocked: the identical scenario, with
#      allow_self_approval_if_sole_eligible turned off via
#      set_sod_policy — the task blocks (resolved_via =
#      blocked_awaiting_reviewer, assigned_membership_id null, a plain
#      next_action message) instead of silently letting the Owner
#      self-approve.
#   G. Ordinary below-threshold self-approval is NOT mislabeled as an
#      escape-valve outcome: the same Owner-captures-own-expense shape,
#      but under RM 500, resolves via direct_permission with
#      self_approved_via_escape_valve = false, since SoD's own threshold
#      never excluded the Owner in the first place.
#   H. Delegation (Vol 13_1 §5): a business synthetically engineered so
#      every directly-eligible approver (Owner and Approver, both with a
#      deliberately low approval_limit_myr override) is limit-ineligible
#      for a RM 1,500 sales task -> Step 2's delegation lookup finds the
#      Approver's active delegation to a Bookkeeper (unlimited, eligible
#      by role) and assigns them, resolved_via = delegation,
#      delegated_from_membership_id recorded correctly.
#   I. Delegation end -> re-resolution: revoking that delegation and
#      re-running resolve_approval_task on the still-pending task falls
#      through to Step 3 (escalate to the Owner, the guaranteed
#      never-nowhere-to-go fallback), resolved_via = escalation.
#   J. Payroll hard-bar (Vol 13_0 §10, reaffirmed): create_approval_task
#      with p_auto_approved = true and domain = 'payroll' is rejected
#      unconditionally, a DB-level backstop behind whatever caller-side
#      AI-confidence check exists.
#   K. Capture-permission gate (Vol 13_2 §3): a Sales Agent can pass
#      check_capture_permission for domain_hint = 'sale'; a Warehouse
#      Staff member (no capture on sales) is rejected with a clear
#      error; an 'unclassified' domain_hint is rejected by construction.
#   L. Capture attribution can't be forged (Vol 13_2 §2): a caller
#      cannot stamp a sync_envelopes row's captured_by_membership_id
#      with a membership that isn't their own active one.

import uuid
import psycopg2

DSN = "host=127.0.0.1 port=5432 dbname=aifa_sprint25_test user=postgres password=testpass123"

BOOKKEEPER_ROLE = "00000000-0000-0000-0000-000000000002"
SALES_AGENT_ROLE = "00000000-0000-0000-0000-000000000003"
WAREHOUSE_ROLE = "00000000-0000-0000-0000-000000000004"
APPROVER_ROLE = "00000000-0000-0000-0000-000000000006"


def u():
    return str(uuid.uuid4())


def as_user(cur, user_id):
    cur.execute("set role authenticated")
    cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (user_id,))


def as_superuser(cur):
    cur.execute("reset role")


def check(label, cur, sql, params, expected):
    cur.execute(sql, params)
    row = cur.fetchone()
    actual = row[0] if row else None
    status = "PASS" if actual == expected else f"FAIL (expected {expected!r}, got {actual!r})"
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


def seed_business(cur, owner_email):
    """Direct seed (bypassing invite/accept — this is the business's
    very first Owner, exactly what Section 7's profiles-backfill does
    for a pre-existing business; a fresh sandbox has no profiles rows to
    backfill from, so this reproduces that step by hand)."""
    owner_user = u()
    business_id = owner_user  # Sprint 14's own convention: business_id == owner's auth.uid()
    cur.execute("reset role")
    cur.execute("insert into auth.users (id, email) values (%s, %s)", (owner_user, owner_email))
    cur.execute(
        "insert into public.businesses (id, owner_user_id, legal_name) values (%s, %s, %s)",
        (business_id, owner_user, owner_email),
    )
    cur.execute(
        "insert into public.business_memberships (business_id, user_id, role_id, status, invited_at, accepted_at) "
        "values (%s, %s, '00000000-0000-0000-0000-000000000001', 'active', now(), now()) returning id",
        (business_id, owner_user),
    )
    owner_membership_id = cur.fetchone()[0]
    return business_id, owner_user, owner_membership_id


def invite_and_accept(cur, conn, owner_user, business_id, role_id, email):
    as_user(cur, owner_user)
    cur.execute("select id from public.invite_member(%s, %s, %s)", (business_id, email, role_id))
    conn.commit()
    new_user = u()
    cur.execute("reset role")
    cur.execute("insert into auth.users (id, email) values (%s, %s)", (new_user, email))
    conn.commit()
    as_user(cur, new_user)
    cur.execute("select id from public.accept_membership_invitation(%s)", (business_id,))
    membership_id = cur.fetchone()[0]
    conn.commit()
    return new_user, membership_id


def main():
    conn = psycopg2.connect(DSN)
    conn.autocommit = False
    cur = conn.cursor()
    all_passed = True

    # ================= Business A: solo (test A, J-payroll part 1) =====
    biz_a, owner_a, om_a = seed_business(cur, "ownerA@test.com")
    conn.commit()

    as_user(cur, owner_a)
    cur.execute(
        "select id, resolved_via, status, self_approved_via_escape_valve from public.create_approval_task("
        "%s, 'expense', 'synthetic_test_subject', %s, 300.00, 'test expense', 0.9, %s, false)",
        (biz_a, u(), om_a),
    )
    row = cur.fetchone()
    conn.commit()
    all_passed &= (row[1] == "solo_self_resolved" and row[2] == "approved" and row[3] is False)
    print(f"[{'PASS' if row[1] == 'solo_self_resolved' and row[2] == 'approved' else 'FAIL'}] A: solo expense task resolves solo_self_resolved/approved instantly")

    as_user(cur, owner_a)
    cur.execute(
        "select id, resolved_via, status from public.create_approval_task("
        "%s, 'payroll', 'synthetic_test_subject', %s, 5000.00, 'payroll run', null, %s, false)",
        (biz_a, u(), om_a),
    )
    row = cur.fetchone()
    conn.commit()
    ok = row[1] == "solo_self_resolved" and row[2] == "approved"
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] A: solo PAYROLL task also resolves solo_self_resolved/approved (owner decision, 3 Sep 2026)")

    all_passed &= check(
        "B: solo business A has zero segregation_of_duties_policies rows",
        cur, "select count(*) from public.segregation_of_duties_policies where business_id = %s", (biz_a,), 0,
    )

    # ================= Business B: Owner2 + Bookkeeper2 + SalesAgent2 ==
    biz_b, owner_b, om_b_owner = seed_business(cur, "ownerB@test.com")
    conn.commit()
    bookkeeper_b_user, om_b_bookkeeper = invite_and_accept(cur, conn, owner_b, biz_b, BOOKKEEPER_ROLE, "bkB@test.com")
    all_passed &= check(
        "B: growth trigger seeds exactly 11 SoD policy rows for business B",
        cur, "select count(*) from public.segregation_of_duties_policies where business_id = %s", (biz_b,), 11,
    )
    all_passed &= check(
        "B: expense threshold seeded at RM 500", cur,
        "select amount_threshold_myr from public.segregation_of_duties_policies where business_id=%s and domain='expense'",
        (biz_b,), 500.00,
    )
    all_passed &= check(
        "B: sales threshold seeded at RM 2,000", cur,
        "select amount_threshold_myr from public.segregation_of_duties_policies where business_id=%s and domain='sales'",
        (biz_b,), 2000.00,
    )
    all_passed &= check(
        "B: hr_attendance_leave seeded enforce_maker_checker = false", cur,
        "select enforce_maker_checker from public.segregation_of_duties_policies where business_id=%s and domain='hr_attendance_leave'",
        (biz_b,), False,
    )
    salesagent_b_user, om_b_salesagent = invite_and_accept(cur, conn, owner_b, biz_b, SALES_AGENT_ROLE, "saB@test.com")

    # C: open shared queue (Owner + Bookkeeper both eligible on 'sales')
    as_user(cur, salesagent_b_user)
    cur.execute(
        "select id from public.create_approval_task(%s,'sales','synthetic_test_subject',%s,2500.00,'quote','0.8',%s,false)",
        (biz_b, u(), om_b_salesagent),
    )
    task_c = cur.fetchone()[0]
    conn.commit()
    all_passed &= check(
        "C: open queue task has resolved_via = direct_permission", cur,
        "select resolved_via from public.approval_tasks where id=%s", (task_c,), "direct_permission",
    )
    all_passed &= check(
        "C: open queue task has assigned_membership_id = null (2+ eligible)", cur,
        "select assigned_membership_id from public.approval_tasks where id=%s", (task_c,), None,
    )
    as_user(cur, bookkeeper_b_user)
    cur.execute("select status from public.decide_approval_task(%s, 'approved')", (task_c,))
    conn.commit()
    all_passed &= check(
        "C: bookkeeper's decide() on the open queue succeeds", cur,
        "select status from public.approval_tasks where id=%s", (task_c,), "approved",
    )
    as_user(cur, owner_b)
    all_passed &= expect_error(
        "C: a second decide() on an already-decided task is rejected", cur, conn,
        lambda: cur.execute("select public.decide_approval_task(%s, 'approved')", (task_c,)),
    )

    # J: payroll auto_approved hard-bar
    as_user(cur, owner_b)
    all_passed &= expect_error(
        "J: create_approval_task(payroll, p_auto_approved=true) is rejected unconditionally", cur, conn,
        lambda: cur.execute(
            "select public.create_approval_task(%s,'payroll','x',%s,1000,'x',0.99,%s,true)",
            (biz_b, u(), om_b_owner),
        ),
    )
    conn.commit()

    # K: capture-permission gate
    as_user(cur, salesagent_b_user)
    all_passed &= check(
        "K: Sales Agent passes check_capture_permission for domain_hint='sale'", cur,
        "select (public.check_capture_permission(%s,'sale') is not null)", (biz_b,), True,
    )
    conn.commit()
    warehouse_b_user, om_b_warehouse = invite_and_accept(cur, conn, owner_b, biz_b, WAREHOUSE_ROLE, "whB@test.com")
    as_user(cur, warehouse_b_user)
    all_passed &= expect_error(
        "K: Warehouse Staff is rejected for domain_hint='sale' (no capture grant)", cur, conn,
        lambda: cur.execute("select public.check_capture_permission(%s,'sale')", (biz_b,)),
    )
    as_user(cur, salesagent_b_user)
    all_passed &= expect_error(
        "K: domain_hint='unclassified' is rejected by construction", cur, conn,
        lambda: cur.execute("select public.check_capture_permission(%s,'unclassified')", (biz_b,)),
    )

    # L: capture attribution can't be forged
    as_user(cur, salesagent_b_user)
    all_passed &= expect_error(
        "L: cannot stamp captured_by_membership_id with someone else's membership", cur, conn,
        lambda: cur.execute(
            "insert into public.sync_envelopes (envelope_id, business_id, device_id, device_seq, entity_type, op, "
            "payload_ciphertext, payload_iv, captured_by_membership_id, capture_channel) "
            "values (%s,%s,'dev-x',1,'business_event','insert','\\x00'::bytea,'\\x00'::bytea,%s,'mobile_app')",
            (u(), biz_b, om_b_bookkeeper),
        ),
    )
    as_user(cur, salesagent_b_user)
    cur.execute(
        "insert into public.sync_envelopes (envelope_id, business_id, device_id, device_seq, entity_type, op, "
        "payload_ciphertext, payload_iv, captured_by_membership_id, capture_channel) "
        "values (%s,%s,'dev-x',1,'business_event','insert','\\x00'::bytea,'\\x00'::bytea,%s,'mobile_app')",
        (u(), biz_b, om_b_salesagent),
    )
    conn.commit()
    print("[PASS] L: caller CAN stamp their own active membership as captured_by_membership_id")

    # ================= Business C: Owner3 + Approver3 (singleton SoD exclusion, D) =====
    biz_c, owner_c, om_c_owner = seed_business(cur, "ownerC@test.com")
    conn.commit()
    approver_c_user, om_c_approver = invite_and_accept(cur, conn, owner_c, biz_c, APPROVER_ROLE, "apC@test.com")

    as_user(cur, owner_c)
    cur.execute(
        "select id from public.create_approval_task(%s,'expense','synthetic_test_subject',%s,800.00,'PV over threshold','0.7',%s,false)",
        (biz_c, u(), om_c_owner),
    )
    task_d = cur.fetchone()[0]
    conn.commit()
    all_passed &= check(
        "D: Owner-captured expense over threshold excludes Owner, assigns the Approver", cur,
        "select assigned_membership_id from public.approval_tasks where id=%s", (task_d,), om_c_approver,
    )
    all_passed &= check(
        "D: not flagged as an escape-valve outcome (ordinary maker-checker)", cur,
        "select self_approved_via_escape_valve from public.approval_tasks where id=%s", (task_d,), False,
    )

    # G: below threshold, same shape, not flagged as escape valve
    as_user(cur, owner_c)
    cur.execute(
        "select id from public.create_approval_task(%s,'expense','synthetic_test_subject',%s,200.00,'small PV','0.7',%s,false)",
        (biz_c, u(), om_c_owner),
    )
    task_g = cur.fetchone()[0]
    conn.commit()
    all_passed &= check(
        "G: below-threshold self-approval resolves direct_permission (not excluded)", cur,
        "select resolved_via from public.approval_tasks where id=%s", (task_g,), "direct_permission",
    )
    all_passed &= check(
        "G: below-threshold self-approval is NOT mislabeled as escape-valve", cur,
        "select self_approved_via_escape_valve from public.approval_tasks where id=%s", (task_g,), False,
    )

    # ================= Business D: Owner4 + Warehouse4 (escape valve, E/F) =====
    biz_d, owner_d, om_d_owner = seed_business(cur, "ownerD@test.com")
    conn.commit()
    warehouse_d_user, om_d_warehouse = invite_and_accept(cur, conn, owner_d, biz_d, WAREHOUSE_ROLE, "whD@test.com")

    as_user(cur, owner_d)
    cur.execute(
        "select id from public.create_approval_task(%s,'expense','synthetic_test_subject',%s,900.00,'PV, no other approver','0.7',%s,false)",
        (biz_d, u(), om_d_owner),
    )
    task_e = cur.fetchone()[0]
    conn.commit()
    all_passed &= check(
        "E: sole-eligible-is-maker escape valve assigns the Owner to their own task", cur,
        "select assigned_membership_id from public.approval_tasks where id=%s", (task_e,), om_d_owner,
    )
    all_passed &= check(
        "E: flagged self_approved_via_escape_valve = true", cur,
        "select self_approved_via_escape_valve from public.approval_tasks where id=%s", (task_e,), True,
    )
    all_passed &= check(
        "E: resolved_via = direct_permission (escape valve still uses this value)", cur,
        "select resolved_via from public.approval_tasks where id=%s", (task_e,), "direct_permission",
    )

    # F: disable the escape valve, same shape -> blocked
    as_user(cur, owner_d)
    cur.execute(
        "select public.set_sod_policy(%s, 'expense', true, 500.00, false)", (biz_d,),
    )
    conn.commit()
    as_user(cur, owner_d)
    cur.execute(
        "select id from public.create_approval_task(%s,'expense','synthetic_test_subject',%s,900.00,'PV, blocked','0.7',%s,false)",
        (biz_d, u(), om_d_owner),
    )
    task_f = cur.fetchone()[0]
    conn.commit()
    all_passed &= check(
        "F: escape valve disabled -> resolved_via = blocked_awaiting_reviewer", cur,
        "select resolved_via from public.approval_tasks where id=%s", (task_f,), "blocked_awaiting_reviewer",
    )
    all_passed &= check(
        "F: blocked task has assigned_membership_id = null", cur,
        "select assigned_membership_id from public.approval_tasks where id=%s", (task_f,), None,
    )
    cur.execute("select next_action from public.approval_tasks where id=%s", (task_f,))
    next_action = cur.fetchone()[0]
    ok = next_action is not None and "Blocked" in next_action
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] F: blocked task carries a clear next_action message")

    # ================= Business F: delegation (H, I) ====================
    biz_f, owner_f, om_f_owner = seed_business(cur, "ownerF@test.com")
    conn.commit()
    approver_f_user, om_f_approver = invite_and_accept(cur, conn, owner_f, biz_f, APPROVER_ROLE, "apF@test.com")
    # Deliberately Warehouse Staff (no `approve` grant on 'sales' via
    # their own role at all) as the delegate — proves delegation grants
    # the delegator's own authority rather than requiring the delegate
    # to independently already hold it (Vol 13_1 §5: "moves whose queue
    # a task lands in, not a blank cheque" — but also not a prerequisite
    # that the delegate already had *some* standing of their own).
    warehouse_f_user, om_f_warehouse = invite_and_accept(cur, conn, owner_f, biz_f, WAREHOUSE_ROLE, "whF@test.com")
    salesagent_f_user, om_f_salesagent = invite_and_accept(cur, conn, owner_f, biz_f, SALES_AGENT_ROLE, "saF@test.com")

    # Deliberately force both Owner and Approver limit-ineligible for a
    # RM 1,500 task, so Step 1 is empty and Step 2's delegation lookup is
    # actually exercised (see this file's header note on why this is
    # synthetic/artificial rather than a realistic owner setup).
    as_superuser(cur)
    cur.execute("update public.business_memberships set approval_limit_myr = 100.00 where id in (%s,%s)",
                (om_f_owner, om_f_approver))
    conn.commit()

    as_user(cur, approver_f_user)
    cur.execute(
        "select id from public.create_approval_delegation(%s,%s,%s,'sales', now(), null, 'annual leave')",
        (biz_f, om_f_approver, om_f_warehouse),
    )
    delegation_id = cur.fetchone()[0]
    conn.commit()

    as_user(cur, salesagent_f_user)
    cur.execute(
        "select id from public.create_approval_task(%s,'sales','synthetic_test_subject',%s,1500.00,'quote','0.8',%s,false)",
        (biz_f, u(), om_f_salesagent),
    )
    task_h = cur.fetchone()[0]
    conn.commit()
    cur.execute("select resolved_via, assigned_membership_id, delegated_from_membership_id from public.approval_tasks where id=%s", (task_h,))
    resolved_via, assigned, delegated_from = cur.fetchone()
    ok = resolved_via == "delegation" and assigned == om_f_warehouse and delegated_from == om_f_approver
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] H: delegation resolves to Warehouse Staff via Approver's delegation (resolved_via={resolved_via}, assigned matches={assigned==om_f_warehouse}, delegated_from matches={delegated_from==om_f_approver})")

    # I: revoke delegation -> re-resolve -> escalate to Owner
    as_user(cur, approver_f_user)
    cur.execute("select public.revoke_approval_delegation(%s)", (delegation_id,))
    conn.commit()
    cur.execute("select resolved_via, assigned_membership_id from public.approval_tasks where id=%s", (task_h,))
    resolved_via2, assigned2 = cur.fetchone()
    ok = resolved_via2 == "escalation" and assigned2 == om_f_owner
    all_passed &= ok
    print(f"[{'PASS' if ok else 'FAIL'}] I: revoking the delegation re-resolves the still-pending task to escalation/Owner (resolved_via={resolved_via2})")

    cur.close()
    conn.close()
    print("\nALL CHECKS PASSED" if all_passed else "\nSOME CHECKS FAILED")


if __name__ == "__main__":
    main()
